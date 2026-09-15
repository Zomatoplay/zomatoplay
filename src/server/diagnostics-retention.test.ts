import assert from "node:assert/strict";
import test from "node:test";

import { runPrune } from "./services/diagnostics-retention.service";

/**
 * Diagnostics retention — the stop conditions.
 *
 * `pipeline_events` was the largest table in the database (28,464 rows, 10 MB,
 * larger than every business table combined) with nothing pruning it. What
 * matters about the prune is not that it deletes — it is **when it stops**, and
 * that is testable without a database.
 *
 * `audit_logs` is deliberately not in scope anywhere here: it is evidence and
 * is kept (CLAUDE.md §22). There is no code path from this module to it.
 */

test("stops as soon as a batch comes back short", async () => {
  // A short batch means the retention window is clear. Continuing would issue
  // statements that match nothing, once per remaining batch.
  let calls = 0;
  const result = await runPrune(
    async () => {
      calls++;
      return calls === 1 ? 2_000 : 17;
    },
    { batchSize: 2_000, maxBatches: 10 },
  );

  assert.equal(calls, 2, "stopped on the short batch rather than running on");
  assert.equal(result.deleted, 2_017);
  assert.equal(result.more, false);
});

test("an empty first batch costs exactly one statement", async () => {
  // The ordinary case on a healthy deployment: nothing is old enough yet.
  let calls = 0;
  const result = await runPrune(
    async () => {
      calls++;
      return 0;
    },
    { batchSize: 2_000, maxBatches: 10 },
  );

  assert.equal(calls, 1);
  assert.equal(result.deleted, 0);
  assert.equal(result.more, false);
});

test("stops at the per-run ceiling and reports that there is more", async () => {
  /*
   * The first prune of a table that has never been pruned could be millions of
   * rows. A scheduled job that runs for an unbounded time on a serverless
   * platform is one that gets killed halfway, so the ceiling is what makes the
   * backlog drain over consecutive runs instead of in one long stall.
   *
   * `more` is what tells an operator the difference between "caught up" and
   * "still behind" — without it the two look identical.
   */
  let calls = 0;
  const result = await runPrune(
    async () => {
      calls++;
      return 2_000;
    },
    { batchSize: 2_000, maxBatches: 10 },
  );

  assert.equal(calls, 10, "never exceeds the ceiling");
  assert.equal(result.deleted, 20_000);
  assert.equal(result.more, true);
});

test("a failing batch is not swallowed", async () => {
  // The caller decides what a failure means. Silently returning a partial
  // count would make a broken prune indistinguishable from a finished one.
  await assert.rejects(
    runPrune(
      async () => {
        throw new Error("connection lost");
      },
      { batchSize: 100, maxBatches: 5 },
    ),
    /connection lost/,
  );
});
