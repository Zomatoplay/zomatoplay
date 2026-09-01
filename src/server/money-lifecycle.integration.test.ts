import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal } from "@/db/money";
import * as t from "@/db/schema";

import {
  createInvestment,
  endOpenEndedInvestment,
} from "./services/investments-write.service";
import { settleInvestments } from "./services/investment-settlement.service";
import { rewardScheduleFor, elapsedDaysFor } from "./services/investment-schedule";
import { creditWallet } from "./services/wallet.service";
import { newId, type Actor } from "./write";

/**
 * The money lifecycle, end to end, against the real database.
 *
 * Deposit → balance → allocation → maturity → principal returned.
 *
 * The gap this protects: `matureInvestment` was implemented, correct and called
 * by nothing, so an allocation took a person's money and then sat `active` past
 * its own `matures_at` for ever with the principal still locked. Nothing in the
 * suite noticed, because nothing exercised the end of the lifecycle.
 *
 * Skipped with no database: writes have no fallback, by design.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_money_test",
  name: "Money Test Operator",
  role: "master_admin",
};

describe("money lifecycle", { skip }, () => {
  let db: Database;
  /** A plan with a real term. Open-ended plans are a separate case — see below. */
  let planId: string;
  /** A plan with `duration_days: 0`, if the catalogue has one. */
  let openEndedPlanId: string | null = null;
  const createdUsers: string[] = [];

  before(async () => {
    db = createAdminDb();
    const plans = await db
      .select({ id: t.plans.id, durationDays: t.plans.durationDays })
      .from(t.plans)
      .where(eq(t.plans.status, "open"));

    /*
     * Chosen by term, not by `limit 1`.
     *
     * The catalogue's first open plan happens to be Flexible Reserve, which has
     * no term at all — so an unordered `limit 1` silently made this whole file
     * a test of the open-ended path while claiming to test maturity.
     */
    const fixed = plans.find((plan) => plan.durationDays > 0);
    assert.ok(fixed, "the catalogue has at least one open fixed-term plan");
    planId = fixed.id;
    openEndedPlanId = plans.find((plan) => plan.durationDays === 0)?.id ?? null;
  });

  after(async () => {
    for (const id of createdUsers) {
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser() {
    const id = newId("usr_moneytest");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-M${suffix}`,
      fullName: `Money Test ${suffix}`,
      email: `money-test-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      referralCode: `MT${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    createdUsers.push(id);
    return id;
  }

  async function balanceOf(userId: string) {
    const [row] = await db
      .select()
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return row;
  }

  test("a credit, an allocation and a maturity keep the ledger and balance agreeing", async () => {
    const userId = await makeUser();

    /*
     * Modelled on `assignDepositToUser`, which is the real path: `creditWallet`
     * moves `available` and leaves the running totals to its caller, because
     * the two do not always agree — an allocation debits `available` by 400 and
     * *raises* `total_invested` by the same 400.
     */
    await creditWallet(
      {
        userId,
        amount: decimal("1000"),
        description: "Test deposit",
        type: "deposit",
        buckets: { totalDeposited: decimal("1000") },
      },
      OPERATOR,
    );

    let wallet = await balanceOf(userId);
    assert.equal(wallet.available, 1000);
    assert.equal(wallet.totalDeposited, 1000);

    const { investmentId } = await createInvestment(
      { userId, planId, amount: decimal("400") },
      OPERATOR,
    );

    wallet = await balanceOf(userId);
    assert.equal(wallet.available, 600, "the principal left available");
    assert.equal(wallet.lockedInInvestments, 400, "and is locked");
    assert.equal(wallet.totalInvested, 400);

    /*
     * The schedule the insert used to leave null.
     *
     * Every seeded allocation carried these; every real one carried neither, so
     * the allocation card read "next reward —" for ever on exactly the rows
     * somebody had paid into.
     */
    const [investment] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    if (investment.rewardFrequency === "on_maturity") {
      assert.ok(investment.nextRewardAt, "an on-maturity plan still has a date");
    } else {
      assert.ok(
        investment.nextRewardAt,
        "a periodic plan has its first reward date stamped",
      );
      assert.ok(
        (investment.nextRewardAmount ?? 0) > 0,
        "and a projected amount to go with it",
      );
    }

    // Backdate past maturity so the settler has something due. This is what a
    // term ending looks like to the job; nothing else about the row changes.
    const matured = new Date(Date.now() - 60_000);
    await db
      .update(t.investments)
      .set({ maturesAt: matured })
      .where(eq(t.investments.id, investmentId));

    const summary = await settleInvestments();
    assert.equal(summary.errors.length, 0, "the pass had no errors");
    assert.ok(summary.matured >= 1, "at least this allocation matured");

    const [after_] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(after_.status, "matured");
    assert.equal(after_.nextRewardAt, null, "a matured allocation owes no reward");

    wallet = await balanceOf(userId);
    assert.equal(wallet.available, 1000, "the principal came back");
    assert.equal(wallet.lockedInInvestments, 0, "and is no longer locked");

    /*
     * The ledger explains the balance — the property `applyLedgerEntry` exists
     * to guarantee (CLAUDE.md §17.3). Deposit +1000, allocation −400,
     * principal +400.
     */
    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
    const sum = ledger.reduce((total, row) => total + row.amount, 0);
    assert.equal(sum, wallet.available, "the ledger sums to the balance");
    assert.equal(ledger.length, 3);
  });

  test("settling twice returns the principal once", async () => {
    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("500"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId, planId, amount: decimal("200") },
      OPERATOR,
    );
    await db
      .update(t.investments)
      .set({ maturesAt: new Date(Date.now() - 60_000) })
      .where(eq(t.investments.id, investmentId));

    await settleInvestments();
    const first = await balanceOf(userId);
    await settleInvestments();
    const second = await balanceOf(userId);

    assert.equal(first.available, 500);
    assert.equal(
      second.available,
      first.available,
      "a second pass is a no-op — the guard is on `status = 'active'`",
    );

    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
    assert.equal(ledger.length, 3, "and writes no second principal-return entry");
  });

  test("an open-ended allocation is never matured by the settler", async (context) => {
    if (!openEndedPlanId) return context.skip("no open-ended plan in the catalogue");

    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("500"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId, planId: openEndedPlanId, amount: decimal("100") },
      OPERATOR,
    );

    /*
     * The trap this test exists for.
     *
     * `duration_days: 0` makes `matures_at` equal `started_at`, so the row
     * matches `matures_at <= now` from the instant it is created. A settler
     * that trusted that column alone would hand the principal straight back and
     * close a product sold as having no lock-in.
     */
    const summaryBefore = await settleInvestments();
    assert.equal(summaryBefore.errors.length, 0);

    const [investment] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(investment.status, "active", "still running after a settlement pass");

    const wallet = await balanceOf(userId);
    assert.equal(wallet.available, 400, "the principal stayed allocated");
    assert.equal(wallet.lockedInInvestments, 100);
  });

  test("a person can return an open-ended allocation, exactly once", async (context) => {
    if (!openEndedPlanId) return context.skip("no open-ended plan in the catalogue");

    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("500"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId, planId: openEndedPlanId, amount: decimal("300") },
      OPERATOR,
    );

    const before = await balanceOf(userId);
    assert.equal(before.available, 200);
    assert.equal(before.lockedInInvestments, 300);

    const first = await endOpenEndedInvestment({ investmentId, userId }, OPERATOR);
    assert.equal(first.ended, true);

    const after = await balanceOf(userId);
    assert.equal(after.available, 500, "the principal came back in full");
    assert.equal(after.lockedInInvestments, 0, "and is released");

    const [row] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(row.status, "matured");

    // Idempotent: `matureInvestment`'s UPDATE asserts `status = 'active'`, so a
    // second request returns nothing rather than paying twice.
    await assert.rejects(
      () => endOpenEndedInvestment({ investmentId, userId }, OPERATOR),
      /already ended/,
    );

    const settled = await balanceOf(userId);
    assert.equal(settled.available, 500, "a repeat does not credit again");

    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
    assert.equal(ledger.length, 3, "deposit, allocation, return — no more");
    assert.equal(
      ledger.reduce((sum, entry) => sum + entry.amount, 0),
      settled.available,
      "the ledger still sums to the balance",
    );
  });

  test("one account cannot return another account's allocation", async (context) => {
    if (!openEndedPlanId) return context.skip("no open-ended plan in the catalogue");

    const owner = await makeUser();
    const stranger = await makeUser();
    await creditWallet(
      { userId: owner, amount: decimal("400"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId: owner, planId: openEndedPlanId, amount: decimal("150") },
      OPERATOR,
    );

    /*
     * The whole attack surface of this action: it takes an allocation id and
     * nothing else, so ownership is the only thing standing between a guessed
     * id and somebody else's money.
     */
    await assert.rejects(
      () => endOpenEndedInvestment({ investmentId, userId: stranger }, OPERATOR),
      /not found on your account/,
    );

    const ownerWallet = await balanceOf(owner);
    assert.equal(ownerWallet.lockedInInvestments, 150, "still allocated");
    assert.equal(ownerWallet.available, 250);
    const strangerWallet = await balanceOf(stranger);
    assert.equal(strangerWallet.available, 0, "and nothing reached the stranger");
  });

  test("a fixed-term allocation cannot be ended this way", async () => {
    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("500"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId, planId, amount: decimal("200") },
      OPERATOR,
    );

    /*
     * The fixed-term plans define early exit with a fee or a forfeiture
     * ("a 2% exit fee on principal", "forfeiture of accrued rewards") and none
     * of that arithmetic exists. Refusing is the honest answer; returning the
     * principal in full would be inventing terms.
     */
    await assert.rejects(
      () => endOpenEndedInvestment({ investmentId, userId }, OPERATOR),
      /fixed term/,
    );

    const wallet = await balanceOf(userId);
    assert.equal(wallet.lockedInInvestments, 200, "still locked");
  });

  test("a long gap between settlement runs catches up rather than drifting", async () => {
    /*
     * THE PROPERTY A SCHEDULER CANNOT BE ASSUMED TO HAVE.
     *
     * Vercel Cron makes no delivery guarantee, and on the Hobby plan it fires
     * once a day at best. So the settler must not assume it ran yesterday. Both
     * halves are written to be *stateless with respect to run history*:
     *
     *  - maturity selects on `matures_at <= now`, so an allocation overdue by
     *    forty days and one overdue by an hour are found by the same pass;
     *  - the schedule is recomputed from `started_at`, never incremented, so
     *    skipping ten reward periods lands on the same answer as ten runs would.
     *
     * This asserts the second, which is the one that could silently drift.
     */
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const maturesAt = new Date("2026-04-01T00:00:00.000Z"); // 90 days, weekly

    const shape = {
      startedAt,
      maturesAt,
      durationDays: 90,
      projectedProfit: 300,
      rewardFrequency: "weekly" as const,
    };

    // Ten periods in, as if nothing had run since day zero.
    const afterLongGap = rewardScheduleFor(shape, new Date("2026-03-12T00:00:00.000Z"));

    // Day 70 exactly; the next boundary is day 77.
    assert.equal(
      afterLongGap.nextRewardAt?.toISOString(),
      new Date("2026-03-19T00:00:00.000Z").toISOString(),
      "the next boundary is computed from the start, not from the last run",
    );

    // Running again a moment later must not move it on again.
    const immediatelyAfter = rewardScheduleFor(
      shape,
      new Date("2026-03-12T00:00:01.000Z"),
    );
    assert.equal(
      immediatelyAfter.nextRewardAt?.toISOString(),
      afterLongGap.nextRewardAt?.toISOString(),
      "a second pass in the same period is a no-op",
    );
    assert.equal(
      elapsedDaysFor(shape, new Date("2026-03-12T00:00:00.000Z")),
      70,
      "elapsed days is a function of the clock, not of how often the job ran",
    );
  });

  test("one settlement pass matures everything overdue, however long the gap", async () => {
    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("1000"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );

    const first = await createInvestment(
      { userId, planId, amount: decimal("100") },
      OPERATOR,
    );
    const second = await createInvestment(
      { userId, planId, amount: decimal("150") },
      OPERATOR,
    );

    // One overdue by forty days, one by a minute. A settler that assumed a run
    // per period would only find the recent one.
    await db
      .update(t.investments)
      .set({ maturesAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) })
      .where(eq(t.investments.id, first.investmentId));
    await db
      .update(t.investments)
      .set({ maturesAt: new Date(Date.now() - 60_000) })
      .where(eq(t.investments.id, second.investmentId));

    const summary = await settleInvestments();
    assert.equal(summary.errors.length, 0);

    const wallet = await balanceOf(userId);
    assert.equal(wallet.available, 1000, "both principals came back in one pass");
    assert.equal(wallet.lockedInInvestments, 0);
  });

  test("the reward schedule matches the arithmetic the seeded data uses", () => {
    // Balanced Growth's shape: 90 days, weekly, 300 USDT projected. The seed
    // says 23.4; the formula gives 300 ÷ (90 ÷ 7) = 23.33.
    const startedAt = new Date("2026-06-18T00:00:00.000Z");
    const maturesAt = new Date("2026-09-16T00:00:00.000Z");
    const schedule = rewardScheduleFor(
      {
        startedAt,
        maturesAt,
        durationDays: 90,
        projectedProfit: 300,
        rewardFrequency: "weekly",
      },
      new Date("2026-08-09T00:00:00.000Z"),
    );

    assert.ok(schedule.nextRewardAmount);
    assert.ok(Math.abs(schedule.nextRewardAmount - 23.33) < 0.01);
    // 52 days in, the next weekly boundary is day 56.
    assert.equal(
      schedule.nextRewardAt?.toISOString(),
      new Date("2026-08-13T00:00:00.000Z").toISOString(),
    );
  });

  test("a term that has run out has no schedule and clamped progress", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const maturesAt = new Date("2026-01-31T00:00:00.000Z");
    const past = new Date("2026-03-01T00:00:00.000Z");

    const schedule = rewardScheduleFor(
      { startedAt, maturesAt, durationDays: 30, projectedProfit: 9, rewardFrequency: "daily" },
      past,
    );
    assert.equal(schedule.nextRewardAt, null);
    assert.equal(schedule.nextRewardAmount, null);

    // Never more than the term, so an allocation the settler has not reached
    // does not read as 59 days of a 30-day plan.
    assert.equal(elapsedDaysFor({ startedAt, durationDays: 30 }, past), 30);
  });
});
