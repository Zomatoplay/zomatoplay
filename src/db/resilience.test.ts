import assert from "node:assert/strict";
import test from "node:test";

import { isTransientConnectionError, withConnectionRetry } from "./resilience";

/**
 * The retry that routes around an unhealthy pooler endpoint.
 *
 * Needs no database: every case here is about *which* failures are retried and
 * how many times, which is exactly the part that must not be decided by whether
 * a network happens to be up while the suite runs.
 */

function driverError(code: string, message = "boom"): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

test("classification", async (t) => {
  await t.test("treats a failed handshake as transient", () => {
    // The exact code the broken Supabase pooler endpoint produces.
    assert.equal(isTransientConnectionError(driverError("CONNECT_TIMEOUT")), true);
    assert.equal(isTransientConnectionError(driverError("ECONNRESET")), true);
    assert.equal(isTransientConnectionError(driverError("CONNECTION_CLOSED")), true);
  });

  await t.test("treats every SQLSTATE class 08 as transient", () => {
    for (const code of ["08000", "08003", "08006", "08001", "08004"]) {
      assert.equal(isTransientConnectionError(driverError(code)), true, code);
    }
  });

  await t.test("does NOT retry an error the server actually returned", () => {
    // These reached Postgres and were rejected. Retrying them would hide a
    // real bug behind three attempts and a delay.
    for (const code of ["23505", "42P01", "42601", "23503", "22P02"]) {
      assert.equal(isTransientConnectionError(driverError(code)), false, code);
    }
    assert.equal(isTransientConnectionError(new Error("no code at all")), false);
    assert.equal(isTransientConnectionError(null), false);
  });

  await t.test("unwraps a nested cause", () => {
    // Drizzle wraps driver errors, so the real reason is a level down.
    const wrapped = new Error("Failed query: select ...", {
      cause: driverError("CONNECT_TIMEOUT"),
    });
    assert.equal(isTransientConnectionError(wrapped), true);
  });

  await t.test("does not recurse forever on a self-referential cause", () => {
    const loop: { cause?: unknown; code: string } = { code: "X" };
    loop.cause = loop;
    assert.equal(isTransientConnectionError(loop), false);
  });
});

test("retrying", async (t) => {
  await t.test("recovers when a later attempt succeeds", async () => {
    let attempts = 0;
    const result = await withConnectionRetry(async () => {
      attempts++;
      // Two bad endpoints, then a healthy one — the real shape of the fault.
      if (attempts < 3) throw driverError("CONNECT_TIMEOUT");
      return "ok";
    });

    assert.equal(result, "ok");
    assert.equal(attempts, 3);
  });

  await t.test("gives a permanent error straight back, on the first try", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withConnectionRetry(async () => {
          attempts++;
          throw driverError("23505", "duplicate key");
        }),
      /duplicate key/,
    );

    assert.equal(attempts, 1, "a constraint violation must not be retried");
  });

  await t.test("stops at the retry limit and rethrows the real error", async () => {
    let attempts = 0;
    await assert.rejects(
      () =>
        withConnectionRetry(
          async () => {
            attempts++;
            throw driverError("CONNECT_TIMEOUT", "endpoint never answered");
          },
          { retries: 2 },
        ),
      // The genuine failure surfaces — a database that is really down must not
      // be dressed up as something softer.
      /endpoint never answered/,
    );

    assert.equal(attempts, 3, "one initial attempt plus two retries");
  });

  await t.test("honours the time budget rather than only the count", async () => {
    let attempts = 0;
    const started = Date.now();

    await assert.rejects(() =>
      withConnectionRetry(
        async () => {
          attempts++;
          await new Promise((r) => setTimeout(r, 120));
          throw driverError("CONNECT_TIMEOUT");
        },
        // Room for roughly one attempt: the budget, not the count, is what
        // bounds how long a caller can be kept waiting.
        { retries: 10, budgetMs: 200 },
      ),
    );

    assert.ok(attempts < 11, `budget must cap attempts, ran ${attempts}`);
    assert.ok(
      Date.now() - started < 1_500,
      "must not keep retrying past its budget",
    );
  });

  await t.test("runs the operation exactly once when it succeeds", async () => {
    // The guard against the worst possible bug in a retry layer: a duplicated
    // effect on the happy path.
    let attempts = 0;
    await withConnectionRetry(async () => {
      attempts++;
      return null;
    });
    assert.equal(attempts, 1);
  });

  await t.test("reports each retry so a recovered fault is still visible", async () => {
    const seen: number[] = [];
    let attempts = 0;

    await withConnectionRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw driverError("CONNECT_TIMEOUT");
        return "ok";
      },
      { onRetry: ({ attempt }) => seen.push(attempt) },
    );

    // Without this the pooler could be failing a third of its connections and
    // nothing anywhere would say so.
    assert.deepEqual(seen, [1, 2]);
  });
});
