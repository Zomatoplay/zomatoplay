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
});
