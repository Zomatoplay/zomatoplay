import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, asc, eq, gt } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal, decimalFrom } from "@/db/money";
import * as t from "@/db/schema";

import {
  createInvestment,
  endOpenEndedInvestment,
} from "./services/investments-write.service";
import { settleInvestments } from "./services/investment-settlement.service";
import {
  earningPeriodCount,
  earningPeriodsFor,
  elapsedDaysFor,
  rewardScheduleFor,
} from "./services/investment-schedule";
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
      .select({
        id: t.plans.id,
        durationDays: t.plans.durationDays,
        minInvestment: t.plans.minInvestment,
      })
      .from(t.plans)
      .where(eq(t.plans.status, "open"))
      /*
       * ORDERED, and that is load-bearing.
       *
       * Chosen by term, not by `limit 1`: the catalogue's first open plan
       * happens to be Flexible Reserve, which has no term at all, so an
       * unordered `limit 1` silently made this whole file a test of the
       * open-ended path while claiming to test maturity.
       *
       * Ordering by minimum on top of that is what stops it being flaky.
       * Without an `ORDER BY`, "first" is physical row order — and every
       * allocation anywhere updates the plan row (`investments-write.service`
       * bumps the plan's totals), which can move it in the heap. After enough
       * earlier test files had run, `find` started returning Balanced Growth
       * (minimum 250) instead of Starter (minimum 50), and the five tests here
       * that allocate 200 failed with "Balanced Growth has a minimum of 250
       * USDT." Observed failing on two consecutive full runs and passing on the
       * third, with no code change in between.
       *
       * Cheapest qualifying plan first, so the amounts below are always valid
       * for whichever plan this picks.
       */
      .orderBy(asc(t.plans.minInvestment), asc(t.plans.id));

    const fixed = plans.find((plan) => plan.durationDays > 0);
    assert.ok(fixed, "the catalogue has at least one open fixed-term plan");
    /*
     * Fail here, once and legibly, rather than five times downstream.
     *
     * Every allocation in this file is between 100 and 400 USDT. If the
     * catalogue ever changes so the cheapest fixed-term plan will not accept
     * that, the previous failure mode was five unrelated-looking tests dying on
     * "…has a minimum of 250 USDT" with nothing pointing at the fixture.
     */
    assert.ok(
      fixed.minInvestment <= 100,
      `this file allocates from 100 USDT; the cheapest open fixed-term plan ` +
        `(${fixed.id}) has a minimum of ${fixed.minInvestment}`,
    );
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

  /**
   * Backdates an allocation so it is overdue for maturity.
   *
   * `started_at` moves back by the same amount as `matures_at`, preserving
   * `duration_days` exactly — a real allocation's `matures_at` is always
   * `started_at + duration_days` (`createInvestment` computes it that way),
   * and a fixture that broke that invariant would exercise a state
   * production code can never actually produce.
   *
   * Necessarily, this also makes every one of the allocation's earning
   * periods due, not only its principal: the final period's due date *is*
   * `matures_at` (`earningPeriodsFor`), so an allocation overdue for
   * maturity was — in the real time the backdate stands in for — overdue for
   * every period along the way too. Tests using this helper assert on that
   * rather than being surprised by it.
   */
  async function backdateToMaturity(investmentId: string, durationDays: number) {
    const maturesAt = new Date(Date.now() - 60_000);
    const startedAt = new Date(maturesAt.getTime() - durationDays * 86_400_000);
    await db
      .update(t.investments)
      .set({ startedAt, maturesAt })
      .where(eq(t.investments.id, investmentId));
    return { startedAt, maturesAt };
  }

  /** How many periods, and how much total profit, an allocation is scheduled for. */
  async function scheduleOf(investmentId: string) {
    const [row] = await db
      .select({
        durationDays: t.investments.durationDays,
        rewardFrequency: t.investments.rewardFrequency,
        projectedProfit: t.investments.projectedProfit,
      })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    return {
      periods: earningPeriodCount(row.durationDays, row.rewardFrequency),
      totalProfit: decimalFrom(row.projectedProfit),
    };
  }

  /**
   * Asserts that a settlement pass raised no error *for the allocation(s)
   * this test owns* — not that the whole pass was error-free.
   *
   * `settleInvestments()` is deliberately global: it processes every active
   * fixed-term allocation in the database, not only the ones a given test
   * created (CLAUDE.md §10a — that is what makes a real cron tick correct).
   * Run inside this suite, that means a pass can also touch scratch rows a
   * *different* integration test file is using at that exact moment, and
   * `summary.errors` is one shared array — a blanket
   * `errors.length === 0` would fail this test for a problem entirely
   * outside it. Scoping the check to this test's own id(s) keeps it able to
   * catch a real regression in the allocation under test while not being
   * hostage to what else the shared database happens to be doing right now.
   */
  function assertNoErrorsFor(summary: { errors: string[] }, ...investmentIds: string[]) {
    for (const id of investmentIds) {
      assert.ok(
        !summary.errors.some((error) => error.startsWith(`${id}:`)),
        `expected no error for ${id}, got: ${summary.errors.join("; ")}`,
      );
    }
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

    // Backdate past maturity so the settler has something due. This
    // necessarily makes every one of its earning periods due too — see
    // `backdateToMaturity`.
    const schedule = await scheduleOf(investmentId);
    await backdateToMaturity(investmentId, investment.durationDays);

    const summary = await settleInvestments();
    assertNoErrorsFor(summary, investmentId);
    assert.ok(summary.matured >= 1, "at least this allocation matured");
    assert.ok(
      summary.earningsCredited >= schedule.periods,
      "every one of its periods was credited, not only the last",
    );

    const [after_] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(after_.status, "matured");
    assert.equal(after_.nextRewardAt, null, "a matured allocation owes no reward");

    wallet = await balanceOf(userId);
    // 1000 deposited, 400 allocated away and back, plus the whole term's
    // scheduled profit — settled exactly once, not approximated.
    const expectedAvailable = 1000 + Number(schedule.totalProfit);
    assert.ok(
      Math.abs(wallet.available - expectedAvailable) < 1e-6,
      `the principal and its full scheduled profit both came back (got ${wallet.available}, expected ${expectedAvailable})`,
    );
    assert.equal(wallet.lockedInInvestments, 0, "and is no longer locked");

    /*
     * The ledger explains the balance — the property `applyLedgerEntry` exists
     * to guarantee (CLAUDE.md §17.3). Deposit +1000, allocation −400,
     * one reward entry per scheduled period, principal +400.
     */
    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
    const sum = ledger.reduce((total, row) => total + row.amount, 0);
    assert.ok(Math.abs(sum - wallet.available) < 1e-6, "the ledger sums to the balance");
    assert.equal(ledger.length, 3 + schedule.periods);
  });

  test("settling twice returns the principal once, and pays no period twice", async () => {
    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("500"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId, planId, amount: decimal("200") },
      OPERATOR,
    );
    const [{ durationDays }] = await db
      .select({ durationDays: t.investments.durationDays })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    const schedule = await scheduleOf(investmentId);
    await backdateToMaturity(investmentId, durationDays);

    await settleInvestments();
    const first = await balanceOf(userId);
    await settleInvestments();
    const second = await balanceOf(userId);

    const expectedAvailable = 500 + Number(schedule.totalProfit);
    assert.ok(Math.abs(first.available - expectedAvailable) < 1e-6);
    assert.equal(
      second.available,
      first.available,
      "a second pass is a no-op — the guard is on `status = 'active'` for maturity, " +
        "and the unique `(investment_id, period_key)` index for earnings",
    );

    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
    assert.equal(
      ledger.length,
      3 + schedule.periods,
      "and writes no second principal-return entry, and no earning twice",
    );
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
    assertNoErrorsFor(summaryBefore, investmentId);

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

  test("a missed cron run catches up every overdue earning period in one pass", async (context) => {
    /*
     * THE PROPERTY A SCHEDULER CANNOT BE ASSUMED TO HAVE.
     *
     * Vercel Cron makes no delivery guarantee, and on the Hobby plan it fires
     * once a day at best. So the settler must not assume it ran yesterday or
     * ever. `creditDueEarnings` selects on each period's own `dueAt <= now`
     * and a cursor recomputed from `started_at`, never incremented — so an
     * allocation nothing has settled for ten days is caught up in the very
     * next pass rather than losing the periods a scheduler never ran for.
     *
     * A daily plan specifically, chosen from the catalogue rather than reusing
     * the file's shared `planId`: an eight-day backdate must land at least one
     * period past due, and a weekly or monthly plan could make that flaky
     * depending on which plan the catalogue happens to list first.
     */
    const [dailyPlan] = await db
      .select({ id: t.plans.id })
      .from(t.plans)
      .where(and(eq(t.plans.rewardFrequency, "daily"), gt(t.plans.durationDays, 0)))
      .limit(1);
    if (!dailyPlan) return context.skip("no daily fixed-term plan in the catalogue");

    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("1000"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId, planId: dailyPlan.id, amount: decimal("300") },
      OPERATOR,
    );

    const [investment] = await db
      .select({
        startedAt: t.investments.startedAt,
        maturesAt: t.investments.maturesAt,
        rewardFrequency: t.investments.rewardFrequency,
        durationDays: t.investments.durationDays,
        projectedProfit: t.investments.projectedProfit,
      })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    // Backdated by shifting both ends of the term back by the same amount —
    // as if this allocation had been running, uncredited, for an extra week.
    // `duration_days` (the gap between them) is unchanged, which is exactly
    // what a missed cron leaves behind: a term of the same length, further
    // along than the last successful pass credited it for.
    const shift = 8 * 24 * 60 * 60 * 1000;
    const backdatedStart = new Date(investment.startedAt.getTime() - shift);
    const backdatedMaturity = new Date(investment.maturesAt.getTime() - shift);
    await db
      .update(t.investments)
      .set({ startedAt: backdatedStart, maturesAt: backdatedMaturity })
      .where(eq(t.investments.id, investmentId));

    const expected = earningPeriodsFor({
      startedAt: backdatedStart,
      maturesAt: backdatedMaturity,
      durationDays: investment.durationDays,
      rewardFrequency: investment.rewardFrequency,
      projectedProfit: decimalFrom(investment.projectedProfit),
    });
    const overdue = expected.filter((period) => period.dueAt <= new Date());
    assert.ok(overdue.length >= 1, "the backdate must leave at least one period due");

    const summary = await settleInvestments();
    assertNoErrorsFor(summary, investmentId);
    assert.ok(
      summary.earningsCredited >= overdue.length,
      "every period overdue by the backdate is credited in the one pass",
    );

    const credited = await db
      .select({ periodKey: t.investmentEarnings.periodKey })
      .from(t.investmentEarnings)
      .where(eq(t.investmentEarnings.investmentId, investmentId));
    assert.equal(
      credited.length,
      overdue.length,
      "exactly the overdue periods were credited — none skipped, none invented",
    );

    const expectedTotal = overdue.reduce(
      (sum, period) => sum + Number(period.amount),
      0,
    );
    const wallet = await balanceOf(userId);
    assert.ok(
      Math.abs(wallet.totalProfit - expectedTotal) < 1e-6,
      "the credited total matches the schedule's own arithmetic",
    );

    // Repeating the pass must not pay any of them again.
    const before = await balanceOf(userId);
    const replaySummary = await settleInvestments();
    assertNoErrorsFor(replaySummary, investmentId);
    const after = await balanceOf(userId);
    assert.equal(after.totalProfit, before.totalProfit, "a replayed pass credits nothing new");
  });

  test("non-compounding periods split the total profit exactly, with no rounding drift", () => {
    /*
     * `splitEvenly` (`@/db/money`) is what makes this exact rather than
     * approximate: `300 ÷ 13` does not divide evenly, and the guarantee this
     * asserts is that the thirteen shares it produces still sum to exactly
     * 300 — no fractional unit invented or lost — for every reward frequency
     * a plan can be configured with.
     */
    const startedAt = new Date("2026-01-01T00:00:00.000Z");

    for (const [rewardFrequency, durationDays] of [
      ["daily", 30],
      ["weekly", 90],
      ["monthly", 365],
      ["on_maturity", 60],
    ] as const) {
      const durationMs = durationDays * 86_400_000;
      const maturesAt = new Date(startedAt.getTime() + durationMs);
      const total = decimal("1000");

      const periods = earningPeriodsFor({
        startedAt,
        maturesAt,
        durationDays,
        rewardFrequency,
        projectedProfit: total,
      });

      // Non-compounding: every period's share is a fixed fraction of the
      // *original* total, so summing every one of them recovers the whole
      // amount that was sold — not more, from a share treated as new
      // principal, and not less, from truncation nobody accounted for.
      // Summed as scaled integers, not floats, for the same reason
      // `splitEvenly` itself uses `BigInt`: a float sum of thirteen shares is
      // exactly the kind of arithmetic that could hide a rounding drift.
      const sum = periods.reduce(
        (running, period) => running + toUnits(period.amount),
        BigInt(0),
      );
      assert.equal(sum, toUnits(total), `${rewardFrequency}: periods must sum to the total exactly`);

      // The final period is always due exactly at maturity — never a
      // calendar boundary that could fall after the term ends.
      assert.equal(
        periods.at(-1)?.dueAt.getTime(),
        maturesAt.getTime(),
        `${rewardFrequency}: the last period is due at maturity, not a boundary past it`,
      );

      // Deterministic, order-based keys — not calendar dates, which would
      // depend on when the job happened to run.
      assert.deepEqual(
        periods.map((p) => p.periodKey),
        periods.map((_, i) => `p${i + 1}`),
      );
    }
  });

  test("crediting the final period and returning principal both happen in one pass at maturity", async () => {
    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("500"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );
    const { investmentId } = await createInvestment(
      { userId, planId, amount: decimal("200") },
      OPERATOR,
    );

    const [investment] = await db
      .select({
        durationDays: t.investments.durationDays,
        rewardFrequency: t.investments.rewardFrequency,
        projectedProfit: t.investments.projectedProfit,
      })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    // Backdated so `now` lands exactly on maturity — the case where the last
    // earning period and the principal return are due on the same tick.
    const startedAt = new Date(Date.now() - investment.durationDays * 86_400_000);
    await db
      .update(t.investments)
      .set({ startedAt, maturesAt: new Date() })
      .where(eq(t.investments.id, investmentId));

    const totalProfit = decimalFrom(investment.projectedProfit);

    const summary = await settleInvestments();
    assertNoErrorsFor(summary, investmentId);
    assert.ok(summary.matured >= 1, "the allocation matured in the same pass");
    assert.ok(summary.earningsCredited >= 1, "and its final period was credited alongside it");

    const wallet = await balanceOf(userId);
    // 500 deposited, 200 locked away, 200 principal back, plus every period's
    // profit — the whole term's worth, credited exactly once.
    assert.ok(
      Math.abs(wallet.available - (500 + Number(totalProfit))) < 1e-6,
      "principal and the full scheduled profit both landed, exactly once",
    );
    assert.equal(wallet.lockedInInvestments, 0);

    const [row] = await db
      .select({ status: t.investments.status })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(row.status, "matured");
  });

  test("Flexible Reserve accrues no scheduled earnings — it has no term to schedule them over", async (context) => {
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

    await settleInvestments();

    const earnings = await db
      .select({ id: t.investmentEarnings.id })
      .from(t.investmentEarnings)
      .where(eq(t.investmentEarnings.investmentId, investmentId));
    assert.equal(earnings.length, 0, "an open-ended allocation is never scheduled for earnings");

    const [row] = await db
      .select({ earningsCreditedPeriods: t.investments.earningsCreditedPeriods })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(row.earningsCreditedPeriods, 0);
  });

  test("changing a plan's rate does not alter an allocation already sold at the old one", async () => {
    const userId = await makeUser();
    await creditWallet(
      { userId, amount: decimal("500"), description: "Test deposit", type: "deposit" },
      OPERATOR,
    );

    const [before] = await db
      .select({ estimatedReturnPercent: t.plans.estimatedReturnPercent })
      .from(t.plans)
      .where(eq(t.plans.id, planId));

    const { investmentId } = await createInvestment(
      { userId, planId, amount: decimal("100") },
      OPERATOR,
    );
    const [sold] = await db
      .select({ projectedProfit: t.investments.projectedProfit })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    /*
     * The operator's edit, applied directly to the row — this is what
     * `updatePlanAction` does to `plans.estimated_return_percent`, and the
     * property under test is what that edit must NOT reach: an allocation
     * that already exists.
     */
    await db
      .update(t.plans)
      .set({ estimatedReturnPercent: before.estimatedReturnPercent + 5 })
      .where(eq(t.plans.id, planId));

    try {
      const [after] = await db
        .select({ projectedProfit: t.investments.projectedProfit })
        .from(t.investments)
        .where(eq(t.investments.id, investmentId));
      assert.equal(
        after.projectedProfit,
        sold.projectedProfit,
        "the allocation's own projected profit is untouched by a later rate change",
      );

      await settleInvestments();
      const [stillUnchanged] = await db
        .select({ projectedProfit: t.investments.projectedProfit })
        .from(t.investments)
        .where(eq(t.investments.id, investmentId));
      assert.equal(
        stillUnchanged.projectedProfit,
        sold.projectedProfit,
        "a settlement pass after the rate change still schedules from the original total",
      );
    } finally {
      // Restore the catalogue rate so no other test in this file — or a
      // concurrent run of it — sees a plan mutated by this one.
      await db
        .update(t.plans)
        .set({ estimatedReturnPercent: before.estimatedReturnPercent })
        .where(eq(t.plans.id, planId));
    }
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
    // per period would only find the recent one. Both backdates preserve
    // `duration_days`, so both allocations' full schedules are also due — see
    // `backdateToMaturity`.
    const [{ durationDays: firstDuration }] = await db
      .select({ durationDays: t.investments.durationDays })
      .from(t.investments)
      .where(eq(t.investments.id, first.investmentId));
    const [{ durationDays: secondDuration }] = await db
      .select({ durationDays: t.investments.durationDays })
      .from(t.investments)
      .where(eq(t.investments.id, second.investmentId));
    const firstSchedule = await scheduleOf(first.investmentId);
    const secondSchedule = await scheduleOf(second.investmentId);
    await backdateToMaturity(first.investmentId, firstDuration);
    await backdateToMaturity(second.investmentId, secondDuration);

    const summary = await settleInvestments();
    assertNoErrorsFor(summary, first.investmentId, second.investmentId);
    assert.ok(summary.matured >= 2, "both allocations matured in the one pass");

    const wallet = await balanceOf(userId);
    const expectedAvailable =
      1000 + Number(firstSchedule.totalProfit) + Number(secondSchedule.totalProfit);
    assert.ok(
      Math.abs(wallet.available - expectedAvailable) < 1e-6,
      "both principals, and both allocations' full scheduled profit, came back in one pass",
    );
    assert.equal(wallet.lockedInInvestments, 0);
  });

  test("the reward schedule shows the next uncredited period, not just the next calendar boundary", () => {
    // Balanced Growth's shape: 90 days, weekly, 300 USDT total profit — a
    // whole 13 periods now (ceil(90 ÷ 7)), not the old fractional 12.86, so
    // every day of the term is actually covered by a period that gets paid.
    const startedAt = new Date("2026-06-18T00:00:00.000Z");
    const maturesAt = new Date("2026-09-16T00:00:00.000Z");
    const projectedProfit = decimal("300");

    // As of day 52 (Aug 9), a cron that has kept up would have credited the
    // 7 periods due on days 7, 14, …, 49 — this is what the settlement job's
    // own cursor (`earnings_credited_periods`) would read at that point.
    const schedule = rewardScheduleFor(
      {
        startedAt,
        maturesAt,
        durationDays: 90,
        projectedProfit,
        rewardFrequency: "weekly",
        earningsCreditedPeriods: 7,
      },
      new Date("2026-08-09T00:00:00.000Z"),
    );

    // 300 ÷ 13, truncated to the schema's scale — one of the twelve equal
    // shares, not the thirteenth (remainder) one.
    assert.equal(schedule.nextRewardAmount, 23.07692307);
    // The 8th period's boundary is day 56.
    assert.equal(
      schedule.nextRewardAt?.toISOString(),
      new Date("2026-08-13T00:00:00.000Z").toISOString(),
    );

    // A cron that has fallen behind — nothing credited yet — shows the
    // oldest unpaid period as next, even though it is already overdue. That
    // is the honest answer: skipping ahead to a future boundary would imply
    // the missed one was somehow already settled.
    const behind = rewardScheduleFor(
      {
        startedAt,
        maturesAt,
        durationDays: 90,
        projectedProfit,
        rewardFrequency: "weekly",
        earningsCreditedPeriods: 0,
      },
      new Date("2026-08-09T00:00:00.000Z"),
    );
    assert.equal(
      behind.nextRewardAt?.toISOString(),
      new Date("2026-06-25T00:00:00.000Z").toISOString(),
      "the first, still-unpaid period — due day 7 — not a future boundary",
    );
  });

  test("a term that has run out has no schedule and clamped progress", () => {
    const startedAt = new Date("2026-01-01T00:00:00.000Z");
    const maturesAt = new Date("2026-01-31T00:00:00.000Z");
    const past = new Date("2026-03-01T00:00:00.000Z");

    const schedule = rewardScheduleFor(
      {
        startedAt,
        maturesAt,
        durationDays: 30,
        projectedProfit: decimal("9"),
        rewardFrequency: "daily",
        earningsCreditedPeriods: 0,
      },
      past,
    );
    assert.equal(schedule.nextRewardAt, null);
    assert.equal(schedule.nextRewardAmount, null);

    // Never more than the term, so an allocation the settler has not reached
    // does not read as 59 days of a 30-day plan.
    assert.equal(elapsedDaysFor({ startedAt, durationDays: 30 }, past), 30);
  });
});

/** Scales an exact decimal string to an integer count of 1e-8 units, for
 * comparing sums without floating point. Mirrors `toUnits` in `@/db/money`,
 * which is intentionally not exported — a test has no business reaching into
 * a module's internals, so this is its own copy of the same three lines. */
function toUnits(amount: string): bigint {
  const negative = amount.startsWith("-");
  const [whole, fraction = ""] = (negative ? amount.slice(1) : amount).split(".");
  const units = BigInt(whole + fraction.padEnd(8, "0"));
  return negative ? -units : units;
}
