import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";

import {
  acknowledgeDeposit,
  listUnacknowledgedDeposits,
} from "./services/deposits.service";
import { newId, type Actor } from "./write";

/**
 * The "USDT deposit confirmed" state, against the real database.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * The defect it was built for: the deposit screen listed recent deposits, so a
 * historical one read as a fresh arrival on every visit. The fix is a database
 * fact — `status = 'credited' and acknowledged_at is null` — and these tests
 * pin the three properties that make it a fix rather than a redesign:
 *
 * 1. only a **credited** deposit is ever announced (not a detected one, not a
 *    confirming one, not one waiting on an operator);
 * 2. an acknowledged deposit is **never** announced again;
 * 3. acknowledgement is **scoped to the owner** and **idempotent**.
 *
 * Skipped with no database: writes have no fallback, by design.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const SYSTEM: Actor = {
  kind: "agent",
  id: "agt_depconf_test",
  name: "Deposit Confirmation Test",
  role: "master_admin",
};

describe("new-deposit confirmation", { skip }, () => {
  let db: Database;
  const createdUsers: string[] = [];
  const createdDeposits: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of createdDeposits) {
      await db.delete(t.deposits).where(eq(t.deposits.id, id));
    }
    for (const id of createdUsers) {
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, SYSTEM.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser() {
    const id = newId("usr_depconf");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-D${suffix}`,
      fullName: `Deposit Test ${suffix}`,
      email: `deposit-conf-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      vipLevel: "vip1",
      referralCode: `DC${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    createdUsers.push(id);
    return id;
  }

  async function makeDeposit(
    userId: string | null,
    status: (typeof t.depositStatusEnum.enumValues)[number],
    options: { acknowledged?: boolean; amount?: string } = {},
  ) {
    const id = newId("dep_conftest");
    const now = new Date();
    await db.insert(t.deposits).values({
      id,
      userId,
      amountUsdt: Number(options.amount ?? "25"),
      chain: "tron",
      chainNetwork: "shasta",
      network: "trc20",
      tokenSymbol: "USDT",
      walletAddress: `TTestAddr${id.slice(-8)}`,
      txHash: `conftest-${id}`,
      status,
      verification: "verified",
      detectedAt: now,
      confirmedAt: status === "credited" ? now : null,
      creditedAt: status === "credited" ? now : null,
      acknowledgedAt: options.acknowledged ? now : null,
      confirmationsCurrent: 19,
      confirmationsRequired: 19,
      createdAt: now,
      updatedAt: now,
    });
    createdDeposits.push(id);
    return id;
  }

  test("a credited, unacknowledged deposit is announced", async () => {
    const user = await makeUser();
    const depositId = await makeDeposit(user, "credited", { amount: "25" });

    const announced = await listUnacknowledgedDeposits(user);
    assert.equal(announced.length, 1);
    assert.equal(announced[0].id, depositId);
    assert.equal(announced[0].amountUsdt, 25);
    assert.equal(announced[0].tokenSymbol, "USDT");
    assert.equal(announced[0].network, "trc20");
    assert.ok(announced[0].creditedAt, "the credit timestamp travels with it");
  });

  test("a deposit that has not been credited is never announced", async () => {
    const user = await makeUser();
    // Every non-terminal state a transfer passes through on the way in. None
    // of them has moved money, so none of them may say "added to your wallet".
    await makeDeposit(user, "detected");
    await makeDeposit(user, "confirming");
    await makeDeposit(user, "confirmed");
    await makeDeposit(user, "failed");

    assert.deepEqual(await listUnacknowledgedDeposits(user), []);
  });

  test("a historical (acknowledged) deposit is not announced again", async () => {
    const user = await makeUser();
    await makeDeposit(user, "credited", { acknowledged: true });

    assert.deepEqual(
      await listUnacknowledgedDeposits(user),
      [],
      "this is the defect the column exists to prevent",
    );
  });

  test("acknowledging removes it, permanently and on the server", async () => {
    const user = await makeUser();
    const depositId = await makeDeposit(user, "credited");

    assert.equal((await listUnacknowledgedDeposits(user)).length, 1);

    const first = await acknowledgeDeposit({ depositId, userId: user }, SYSTEM);
    assert.equal(first.acknowledged, true);

    assert.deepEqual(
      await listUnacknowledgedDeposits(user),
      [],
      "a refresh does not bring it back — the marker is a column, not localStorage",
    );

    const [row] = await db
      .select({ acknowledgedAt: t.deposits.acknowledgedAt })
      .from(t.deposits)
      .where(eq(t.deposits.id, depositId));
    assert.ok(row.acknowledgedAt, "the marker is stored");
  });

  test("acknowledging twice is a no-op, not an error", async () => {
    const user = await makeUser();
    const depositId = await makeDeposit(user, "credited");

    await acknowledgeDeposit({ depositId, userId: user }, SYSTEM);
    const second = await acknowledgeDeposit({ depositId, userId: user }, SYSTEM);

    // `false` means "nothing to do", which is what a double-tap, a retry and a
    // second open tab all produce.
    assert.equal(second.acknowledged, false);
  });

  test("one account cannot acknowledge another's deposit", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const depositId = await makeDeposit(owner, "credited");

    const result = await acknowledgeDeposit(
      { depositId, userId: stranger },
      SYSTEM,
    );
    assert.equal(result.acknowledged, false, "the ownership clause matched no row");

    assert.equal(
      (await listUnacknowledgedDeposits(owner)).length,
      1,
      "and the owner is still shown their own confirmation",
    );
  });

  test("acknowledging cannot credit, advance or resurrect a deposit", async () => {
    const user = await makeUser();
    // A transfer still waiting on finality. Acknowledging it must do nothing:
    // the `WHERE` clause requires `status = 'credited'`.
    const depositId = await makeDeposit(user, "confirming");

    const result = await acknowledgeDeposit({ depositId, userId: user }, SYSTEM);
    assert.equal(result.acknowledged, false);

    const [row] = await db
      .select({
        status: t.deposits.status,
        creditedAt: t.deposits.creditedAt,
        acknowledgedAt: t.deposits.acknowledgedAt,
      })
      .from(t.deposits)
      .where(eq(t.deposits.id, depositId));

    assert.equal(row.status, "confirming", "the status is untouched");
    assert.equal(row.creditedAt, null, "nothing was credited");
    assert.equal(row.acknowledgedAt, null);
  });

  test("each new deposit gets its own confirmation", async () => {
    const user = await makeUser();
    const first = await makeDeposit(user, "credited", { amount: "25" });
    await acknowledgeDeposit({ depositId: first, userId: user }, SYSTEM);

    assert.deepEqual(await listUnacknowledgedDeposits(user), []);

    const second = await makeDeposit(user, "credited", { amount: "40" });
    const announced = await listUnacknowledgedDeposits(user);

    assert.equal(announced.length, 1, "the new one is announced");
    assert.equal(announced[0].id, second);
    assert.equal(announced[0].amountUsdt, 40);
  });

  test("the historical backfill left no seeded deposit unannounced", async () => {
    /*
     * The migration marked every already-credited deposit acknowledged, so the
     * first person to open the wallet after the deploy is not shown every
     * deposit they have ever made. Asserted as a property of the *seeded*
     * rows — a deposit credited after the migration is legitimately
     * unacknowledged, and counting rows would make a real credit read as a
     * regression (CLAUDE.md §16.7).
     */
    const stale = await db
      .select({ id: t.deposits.id })
      .from(t.deposits)
      .where(
        and(
          eq(t.deposits.status, "credited"),
          isNull(t.deposits.acknowledgedAt),
          // Only rows from before this session's work.
          eq(t.deposits.chainNetwork, "mainnet"),
        ),
      );

    for (const row of stale) {
      assert.ok(
        row.id.startsWith("dep_conftest") || createdDeposits.includes(row.id),
        `deposit ${row.id} predates the backfill and would be re-announced`,
      );
    }
  });
});
