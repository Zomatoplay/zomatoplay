import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { sql } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, getDb } from "./client";
import { isDatabaseConfigured, usesTransactionPooler } from "./env";

/**
 * The connection itself.
 *
 * The parallel-load case below is the important one, and it is here because it
 * has already failed once: pointed at Supabase's *transaction* pooler, this
 * driver stops answering once more than about two queries queue on a
 * connection. Nothing else in the suite would have caught it — every query was
 * individually correct — and the symptom in the application was a page that
 * hung rather than an error. A render issues six to fourteen queries at once,
 * so that is what this asks the pool for.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

describe("connection", { skip }, () => {
  after(async () => {
    await closeDb();
  });

  test("the runtime pool answers", async () => {
    const [row] = await getDb().execute<{ ok: number }>(sql`select 1 as ok`);
    assert.equal(row.ok, 1);
  });

  test("the admin connection answers and is closable", async () => {
    const db = createAdminDb();
    try {
      const [row] = await db.execute<{ ok: number }>(sql`select 1 as ok`);
      assert.equal(row.ok, 1);
    } finally {
      await closeAdminDb(db);
    }
  });

  test("prepared statements are off exactly when the pooler needs them off", () => {
    const url = process.env.DATABASE_URL ?? "";
    // Both readings of the URL must agree; the client derives its `prepare`
    // setting from this and nothing else.
    assert.equal(
      usesTransactionPooler(url),
      new URL(url).port === "6543" ||
        new URL(url).searchParams.get("pgbouncer") === "true",
    );
  });

  test("survives a page's worth of parallel queries", async () => {
    const db = getDb();
    const started = Date.now();

    const rows = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.execute<{ i: number }>(sql`select ${i}::int as i`),
      ),
    );

    assert.equal(rows.length, 20);
    assert.deepEqual(
      rows.map(([row]) => row.i),
      Array.from({ length: 20 }, (_, i) => i),
      "every query must come back, and with its own result",
    );
    // Generous: this is a network round trip to a managed database, not a
    // benchmark. It is here to fail on a stall, not on a slow link.
    assert.ok(
      Date.now() - started < 20_000,
      "20 parallel queries should not take 20 seconds",
    );
  });

  test("queues more work than the pool has connections", async () => {
    // The exact shape that stalled: far more queued queries than connections.
    const db = getDb();
    const results = await Promise.all(
      Array.from({ length: 40 }, () => db.execute<{ ok: number }>(sql`select 1 as ok`)),
    );
    assert.equal(results.length, 40);
    assert.ok(results.every(([row]) => row.ok === 1));
  });

  /**
   * The regression test for `EMAXCONNSESSION`.
   *
   * `idle_timeout: 0` means a connection is never handed back for being idle.
   * On the *session* pooler that is not "keeping a connection warm" — it is
   * permanently claiming up to `max` of a fifteen-slot, project-wide budget,
   * for the whole life of the process. Three idle instances therefore lock out
   * every other one, at zero traffic, on localhost and on Vercel alike:
   *
   *   (EMAXCONNSESSION) max clients reached in session mode
   *   - max clients are limited to pool_size: 15
   *
   * Reproduced and re-verified by measuring the open sockets: at `0` all
   * fifteen were still held 55s after the last query and a new client was
   * refused; at 30 they drained by ~40s and the same client connected.
   *
   * This asserts the two numbers whose product is that budget, because the
   * failure they cause appears nowhere in this suite — it needs a second
   * process to be visible at all.
   */
  test("the pool cannot exhaust the project's session-mode budget", () => {
    const options = getDb().$client.options as { idle_timeout: number; max: number };

    assert.notEqual(
      options.idle_timeout,
      0,
      "idle_timeout 0 never releases a session-mode connection: see EMAXCONNSESSION above",
    );
    assert.ok(
      options.max * 3 <= 15,
      `max ${options.max} leaves room for fewer than three instances inside the ` +
        `project's fifteen session-mode clients`,
    );
  });
});
