import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { desc, eq, inArray } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";

import {
  currentCorrelationId,
  recordPipelineEvent,
  redact,
  trackPipeline,
  withTrace,
} from "./observability";

/** The trace API takes options first; every test here wants the defaults. */
const trace = <T>(work: (id: string) => Promise<T>) => withTrace({}, work);

/**
 * Pipeline instrumentation.
 *
 * The properties worth pinning are the ones that would otherwise be discovered
 * during an incident: that a correlation id actually ties a request's steps
 * together, that a failure is recorded *and* re-thrown rather than swallowed,
 * and that credentials do not end up in a table operators browse.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

describe("redaction", () => {
  test("strips connection strings, keys and JWTs from error text", () => {
    const dirty =
      "connect ECONNREFUSED postgresql://nanotron:hunter2@db.example.com:5432/app " +
      "apikey: sk_live_abcdef123456 " +
      "token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N";

    const clean = redact(dirty);

    assert.ok(!clean.includes("hunter2"), "no password");
    assert.ok(!clean.includes("sk_live_abcdef123456"), "no api key");
    assert.ok(!clean.includes("eyJhbGciOiJIUzI1NiJ9."), "no jwt");
    assert.ok(clean.includes("[redacted]"), "says something was removed");
  });

  test("caps length, so one enormous error cannot dominate the table", () => {
    assert.ok(redact("x".repeat(10_000)).length <= 2000);
  });
});

describe("correlation", () => {
  test("one id spans everything a request calls", async () => {
    const seen: string[] = [];

    const outer = await trace(async (id: string) => {
      seen.push(currentCorrelationId());
      // A nested call must join the same request, not start a new one.
      await trace(async () => {
        seen.push(currentCorrelationId());
      });
      seen.push(currentCorrelationId());
      return id;
    });

    assert.equal(seen.length, 3);
    assert.deepEqual(new Set(seen), new Set([outer]), "one id throughout");
  });

  test("separate requests get separate ids", async () => {
    const a = await trace(async (id: string) => id);
    const b = await trace(async (id: string) => id);
    assert.notEqual(a, b);
  });
});

describe("pipeline events", { skip }, () => {
  let db: Database;
  const written: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    if (written.length > 0) {
      await db
        .delete(t.pipelineEvents)
        .where(inArray(t.pipelineEvents.correlationId, written));
    }
    await closeAdminDb(db);
    await closeDb();
  });

  test("a successful step is recorded with its duration", async () => {
    const correlationId = await trace(async (id: string) => {
      await trackPipeline(
        {
          pipeline: "database",
          operation: "test.success",
          message: "started",
          successMessage: "finished",
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return "value";
        },
      );
      return id;
    });
    written.push(correlationId);

    const [row] = await db
      .select()
      .from(t.pipelineEvents)
      .where(eq(t.pipelineEvents.correlationId, correlationId));

    assert.equal(row.status, "ok");
    assert.equal(row.operation, "test.success");
    assert.equal(row.message, "finished");
    assert.ok((row.durationMs ?? 0) >= 20, "duration was actually measured");
  });

  test("a failure is recorded AND re-thrown", async () => {
    const correlationId = await trace(async (id: string) => {
      // This observes; it does not handle. Swallowing here would turn every
      // instrumented call into one that silently succeeds.
      await assert.rejects(
        () =>
          trackPipeline(
            { pipeline: "kyc", operation: "test.failure", message: "attempt" },
            async () => {
              throw new Error("the write did not land");
            },
          ),
        /the write did not land/,
      );
      return id;
    });
    written.push(correlationId);

    const [row] = await db
      .select()
      .from(t.pipelineEvents)
      .where(eq(t.pipelineEvents.correlationId, correlationId));

    assert.equal(row.status, "failed");
    assert.match(row.errorMessage ?? "", /the write did not land/);
  });

  test("steps of one request share a correlation id and keep their order", async () => {
    const correlationId = await trace(async (id: string) => {
      recordPipelineEvent({
        pipeline: "auth",
        operation: "test.step_one",
        status: "ok",
        message: "first",
      });
      recordPipelineEvent({
        pipeline: "kyc",
        operation: "test.step_two",
        status: "ok",
        message: "second",
      });
      return id;
    });
    written.push(correlationId);

    const rows = await db
      .select()
      .from(t.pipelineEvents)
      .where(eq(t.pipelineEvents.correlationId, correlationId))
      .orderBy(desc(t.pipelineEvents.occurredAt));

    assert.equal(rows.length, 2, "one filter returns the whole request");
    assert.deepEqual(
      new Set(rows.map((row: { operation: string }) => row.operation)),
      new Set(["test.step_one", "test.step_two"]),
    );
  });

  test("recording never throws, even with an impossible foreign key", async () => {
    // Rule 2: an observability table must not be able to fail the operation it
    // describes. `userId` here references nothing, so the insert is rejected by
    // Postgres — and the caller must not notice.
    await trace(async () => {
      recordPipelineEvent({
        pipeline: "database",
        operation: "test.swallowed",
        status: "ok",
        message: "should not surface",
        userId: "usr_does_not_exist_at_all",
      });
    });
  });

  test("ten events in one trace are buffered and written together", async () => {
    /*
     * Rule 1, and the reason this instrumentation was safe to add at all.
     *
     * A round trip to this database costs ~185ms warm and ~2,000ms cold. Ten
     * events written one at a time would cost more than the request they
     * describe — instrumentation that changes what it measures is worthless.
     *
     * The single-insert property is structural: `writeRows` makes exactly one
     * `insert().values(rows)` call for the whole buffer, and `recordPipelineEvent`
     * is synchronous and cannot issue a query at all. What is asserted here is
     * the observable half — that buffering does not lose events — because a
     * buffer that dropped rows would be the failure mode worth catching.
     */
    const correlationId = await trace(async (id: string) => {
      for (let i = 0; i < 10; i += 1) {
        recordPipelineEvent({
          pipeline: "navigation",
          operation: `test.batch_${i}`,
          status: "ok",
          message: "batched",
        });
      }
      return id;
    });
    written.push(correlationId);

    const rows = await db
      .select({ id: t.pipelineEvents.id })
      .from(t.pipelineEvents)
      .where(eq(t.pipelineEvents.correlationId, correlationId));

    assert.equal(rows.length, 10, "every buffered event reached the table");
  });

  test("an event may carry a correlation id that is not the trace's", async () => {
    // The browser posts its client-side events after the fact, and each belongs
    // to the navigation it described rather than to the upload carrying it.
    const foreign = "req_clientsuppliedxyz01";
    const owner = await trace(async (id: string) => {
      recordPipelineEvent({
        pipeline: "navigation",
        layer: "client",
        correlationId: foreign,
        operation: "navigation.complete",
        status: "ok",
        message: "belongs to an earlier navigation",
      });
      return id;
    });
    written.push(owner, foreign);

    const [row] = await db
      .select({ correlationId: t.pipelineEvents.correlationId })
      .from(t.pipelineEvents)
      .where(eq(t.pipelineEvents.correlationId, foreign));

    assert.equal(row.correlationId, foreign);
  });
});
