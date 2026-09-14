import assert from "node:assert/strict";
import test from "node:test";

import {
  isPoolExhaustionError,
  isTransientConnectionError,
  withConnectionRetry,
} from "./resilience";

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

  await t.test("treats a full connection pooler as transient", () => {
    /*
     * THE EXACT ERROR THAT BROKE ADMIN SIGN-IN, REPRODUCED AGAINST THE LIVE
     * PROJECT ON 2026-09-14 AND PINNED HERE.
     *
     * Supavisor in session mode completes TLS and SCRAM and then answers with
     * a FATAL ErrorResponse. postgres.js surfaces it as a `PostgresError` whose
     * `code` is `XX000` — `internal_error`, which is deliberately NOT retried
     * on its own — so the code alone was not enough to classify it and the
     * retry never fired. Five consecutive `admin.resolveOperator` failures over
     * 78 seconds, then a success, with no `database.connectRetry` row between
     * them.
     */
    const exhausted = Object.assign(
      new Error(
        "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15",
      ),
      { code: "XX000", name: "PostgresError" },
    );
    assert.equal(isPoolExhaustionError(exhausted), true);
    assert.equal(isTransientConnectionError(exhausted), true);

    // Postgres' own version of the same condition.
    assert.equal(
      isTransientConnectionError(driverError("53300", "too many clients already")),
      true,
    );
    assert.equal(
      isTransientConnectionError(
        driverError("XX000", "remaining connection slots are reserved"),
      ),
      true,
    );
  });

  await t.test("does NOT retry XX000 on its own", () => {
    /*
     * The guard that keeps the fix above honest. `XX000` is `internal_error` —
     * a genuine server-side fault, a failed assertion, an extension crashing —
     * and retrying that class blindly would turn one loud bug into three quiet
     * ones. The message is what distinguishes the pooler's refusal, so only
     * both together count.
     */
    assert.equal(
      isTransientConnectionError(driverError("XX000", "internal error in tuplesort")),
      false,
    );
    assert.equal(isPoolExhaustionError(driverError("XX000", "something else")), false);
  });

  await t.test("finds a full pooler through Drizzle's wrapper", () => {
    // What actually arrives in production: the message is the SQL text and the
    // reason is one level down.
    const wrapped = new Error('Failed query: select "admin_agents"."id" …', {
      cause: Object.assign(
        new Error("(EMAXCONNSESSION) max clients reached in session mode"),
        { code: "XX000", name: "PostgresError" },
      ),
    });
    assert.equal(isTransientConnectionError(wrapped), true);
    assert.equal(isPoolExhaustionError(wrapped), true);
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

  await t.test("spends more attempts on a full pooler than on a bad endpoint", async () => {
    /*
     * The two faults want different waits, and this is the assertion that says
     * so. A bad pooler endpoint is fixed by landing on a different A record, so
     * two attempts a fifth of a second apart is enough. A *full* pooler refuses
     * every endpoint until somebody's connection is handed back — so the same
     * two quick attempts are effectively one, and the budget is better spent on
     * more attempts spread further out.
     */
    const exhausted = () =>
      Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode"), {
        code: "XX000",
      });

    let attempts = 0;
    const delays: number[] = [];
    await assert.rejects(
      withConnectionRetry(
        async () => {
          attempts++;
          throw exhausted();
        },
        {
          // A generous budget so the attempt count, not the clock, is what
          // ends this. The delays are asserted separately below.
          budgetMs: 60_000,
          onRetry: ({ delayMs, reason }) => {
            delays.push(delayMs);
            assert.equal(reason, "pool_exhausted");
          },
        },
      ),
    );

    // Five attempts: the first plus POOL_EXHAUSTION_RETRIES.
    assert.equal(attempts, 5);
    // Each wait is longer than the previous, and the first is already well
    // clear of the 120ms a bad-endpoint retry uses.
    assert.ok(delays[0] >= 700, `first delay was ${delays[0]}ms`);
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] > delays[i - 1], `delays not increasing: ${delays.join(",")}`);
    }
  });

  await t.test("still honours the budget when the pooler is full", async () => {
    // The extra attempts must not extend the wall-clock promise a caller was
    // given. The budget is checked before each wait, so a short budget ends the
    // loop early rather than letting five attempts run.
    let attempts = 0;
    const started = Date.now();
    await assert.rejects(
      withConnectionRetry(
        async () => {
          attempts++;
          throw Object.assign(
            new Error("(EMAXCONNSESSION) max clients reached in session mode"),
            { code: "XX000" },
          );
        },
        { budgetMs: 900 },
      ),
    );
    assert.ok(attempts < 5, `expected the budget to cut this short, got ${attempts}`);
    assert.ok(Date.now() - started < 3_000);
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
