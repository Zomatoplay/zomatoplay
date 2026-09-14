import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, asc, eq, like } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal } from "@/db/money";
import * as t from "@/db/schema";

import { createInvestment, InvestmentError } from "./services/investments-write.service";
import {
  previewPlanRate,
  savePlanRateTiers,
  PlanTierWriteError,
} from "./services/plan-tiers-write.service";
import { creditWallet } from "./services/wallet.service";
import { newId, type Actor } from "./write";

/**
 * The rate ladder, against the real database.
 *
 * WHAT THIS PROTECTS THAT THE UNIT TESTS CANNOT
 * ----------------------------------------------
 * `plan-tiers.test.ts` proves the *rule* — where the boundaries are, what
 * validates. This proves the *wiring*: that `createInvestment` resolves a band
 * from the rows Postgres holds rather than from anything a caller said, that
 * what it resolved is copied onto the allocation, and — the one that matters
 * most — that editing a band afterwards changes nothing about an allocation
 * already sold (CLAUDE.md §10b, extended to tiers).
 *
 * Everything runs against a plan this file creates and deletes, so it never
 * touches the catalogue the CRM or a customer is looking at.
 *
 * Skipped with no database: writes have no fallback, by design.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_tier_test",
  name: "Tier Test Operator",
  role: "master_admin",
};

describe("plan rate tiers", { skip }, () => {
  let db: Database;
  let planId: string;
  const createdUsers: string[] = [];

  before(async () => {
    db = createAdminDb();

    /*
     * Clear anything a previous run left behind before creating this one's.
     *
     * `after()` deletes the fixture plan, but a run killed mid-file never gets
     * there — and a leaked plan is not harmless: `data-access.integration.test`
     * asserts the catalogue has exactly five plans, so one stray fixture makes
     * an unrelated file fail on every run afterwards. Cleaning up on the way
     * *in* as well as on the way out is what makes that self-healing.
     */
    await db.delete(t.plans).where(like(t.plans.id, "plan_tiertest%"));

    planId = newId("plan_tiertest");

    // A plan of this file's own, so an edit here can never reprice a real one.
    await db.insert(t.plans).values({
      id: planId,
      slug: `tier-test-${planId.slice(-8)}`,
      name: "Tier Test Plan",
      tagline: "Fixture",
      description: "Created and deleted by plan-tiers.integration.test.ts.",
      minInvestment: 10,
      maxInvestment: 100_000,
      durationDays: 30,
      estimatedReturnPercent: 8,
      estimatedReturnLow: 6,
      estimatedReturnHigh: 10,
      rewardFrequency: "daily",
      risk: "balanced",
      status: "open",
      earlyExit: "Fixture plan.",
      sortOrder: 9999,
    });
  });

  after(async () => {
    for (const id of createdUsers) {
      await db.delete(t.investments).where(eq(t.investments.userId, id));
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await db.delete(t.planRateTiers).where(eq(t.planRateTiers.planId, planId));
    await db.delete(t.planRateHistory).where(eq(t.planRateHistory.planId, planId));
    await db.delete(t.plans).where(eq(t.plans.id, planId));
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeInvestor(float: string) {
    const id = newId("usr_tiertest");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-T${suffix}`,
      fullName: `Tier Test ${suffix}`,
      email: `tier-test-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      vipLevel: "vip1",
      referralCode: `TT${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    createdUsers.push(id);
    await creditWallet(
      { userId: id, amount: decimal(float), description: "Test float", type: "deposit" },
      OPERATOR,
    );
    return id;
  }

  async function setLadder(
    tiers: Array<{ min: number; max: number | null; rate: number; active?: boolean }>,
  ) {
    const existing = await db
      .select({ id: t.planRateTiers.id, min: t.planRateTiers.minAmountUsdt })
      .from(t.planRateTiers)
      .where(eq(t.planRateTiers.planId, planId))
      .orderBy(asc(t.planRateTiers.minAmountUsdt));

    await savePlanRateTiers(
      {
        planId,
        tiers: tiers.map((tier) => ({
          // Reuse the id of the band at the same lower bound, so an "edit the
          // rate" case really edits rather than replacing the row — which is
          // what makes the historical-protection test below meaningful.
          id: existing.find((row) => row.min === tier.min)?.id,
          minAmountUsdt: tier.min,
          maxAmountUsdt: tier.max,
          ratePercent: tier.rate,
          active: tier.active ?? true,
        })),
      },
      OPERATOR,
    );
  }

  const STANDARD = [
    { min: 10, max: 50, rate: 2 },
    { min: 50, max: 100, rate: 3 },
    { min: 100, max: null, rate: 5 },
  ];

  /* ---------------------------------------------------------- validation -- */

  test("a valid ladder saves, and comes back in lower-bound order", async () => {
    await setLadder(STANDARD);
    const rows = await db
      .select()
      .from(t.planRateTiers)
      .where(eq(t.planRateTiers.planId, planId))
      .orderBy(asc(t.planRateTiers.minAmountUsdt));

    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((row) => [row.minAmountUsdt, row.maxAmountUsdt, row.ratePercent]),
      [
        [10, 50, 2],
        [50, 100, 3],
        [100, null, 5],
      ],
    );
  });

  test("the save is audited, with the ladder before and after", async () => {
    const [entry] = await db
      .select()
      .from(t.auditLogs)
      .where(
        and(eq(t.auditLogs.actorId, OPERATOR.id), eq(t.auditLogs.targetId, planId)),
      )
      .orderBy(asc(t.auditLogs.createdAt))
      .limit(1);

    assert.ok(entry, "the tier save wrote an audit entry");
    assert.equal(entry.action, "plan_updated");
    assert.match(entry.details, /rate tiers/i);
    assert.match(
      entry.details,
      /existing allocations keep the tier and rate they were sold at/i,
    );
  });

  test("an overlapping ladder is refused by the server, not only by the form", async () => {
    await assert.rejects(
      () =>
        savePlanRateTiers(
          {
            planId,
            tiers: [
              { minAmountUsdt: 10, maxAmountUsdt: 60, ratePercent: 2, active: true },
              { minAmountUsdt: 50, maxAmountUsdt: null, ratePercent: 3, active: true },
            ],
          },
          OPERATOR,
        ),
      (error: unknown) =>
        error instanceof PlanTierWriteError && /overlap/i.test(error.message),
    );
  });

  test("a ladder leaving part of the plan's range unpriced is refused", async () => {
    await assert.rejects(
      () =>
        savePlanRateTiers(
          {
            // The plan accepts from 10 USDT; this starts at 50.
            planId,
            tiers: [
              { minAmountUsdt: 50, maxAmountUsdt: null, ratePercent: 3, active: true },
            ],
          },
          OPERATOR,
        ),
      (error: unknown) =>
        error instanceof PlanTierWriteError && /could not be priced/i.test(error.message),
    );
  });

  test("a rate finer than the column stores is refused, not silently rounded", async () => {
    // `percent` is numeric(8, 4). 2.12345 would round to 2.1235 on assignment
    // and the operator would never be told their rate had changed.
    await assert.rejects(
      () =>
        savePlanRateTiers(
          {
            planId,
            tiers: [
              { minAmountUsdt: 10, maxAmountUsdt: null, ratePercent: 2.12345, active: true },
            ],
          },
          OPERATOR,
        ),
      (error: unknown) =>
        error instanceof PlanTierWriteError && /decimal places/i.test(error.message),
    );
  });

  test("a refused save leaves the stored ladder exactly as it was", async () => {
    // The refusal happens inside `mutate`, so the transaction rolls back — a
    // half-written ladder would be one an allocation could be priced against.
    const rows = await db
      .select()
      .from(t.planRateTiers)
      .where(eq(t.planRateTiers.planId, planId));
    assert.equal(rows.length, 3, "the earlier valid ladder is untouched");
  });

  /* ------------------------------------------------------------- preview -- */

  test("the preview prices an amount with the same function an allocation uses", async () => {
    await setLadder(STANDARD);

    const at49 = await previewPlanRate(planId, "49.99");
    assert.equal(at49.resolved.ratePercent, 2);
    assert.equal(at49.resolved.source, "tier");

    const at50 = await previewPlanRate(planId, "50");
    assert.equal(at50.resolved.ratePercent, 3, "50 belongs to the band starting at 50");

    const at100 = await previewPlanRate(planId, "100");
    assert.equal(at100.resolved.ratePercent, 5);
    assert.equal(at100.resolved.maxAmountUsdt, null, "the top band is open-ended");

    // The projected profit is exact, computed by `applyPercent` — the same path
    // `createInvestment` takes — so the preview and the allocation agree.
    assert.equal(at100.projectedProfitUsdt, "5");
  });

  /* ---------------------------------------------------------- allocation -- */

  test("an allocation is priced at the band its amount falls into, and the band is recorded", async () => {
    await setLadder(STANDARD);
    const investor = await makeInvestor("1000");

    const { investmentId, appliedRatePercent } = await createInvestment(
      { userId: investor, planId, amount: decimal("75") },
      OPERATOR,
    );

    assert.equal(appliedRatePercent, 3, "75 is in the 50–100 band");

    const [row] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    assert.equal(row.appliedRatePercent, 3);
    assert.equal(row.appliedTierMinUsdt, 50);
    assert.equal(row.appliedTierMaxUsdt, 100);
    assert.ok(row.appliedTierId, "the band's id is recorded");
    // 3% of 75, exactly.
    assert.equal(row.projectedProfit, 2.25);
  });

  test("the boundary is half-open where it actually matters — in the ledger", async () => {
    await setLadder(STANDARD);

    const justUnder = await makeInvestor("1000");
    const exactly = await makeInvestor("1000");

    const a = await createInvestment(
      { userId: justUnder, planId, amount: decimal("49.99") },
      OPERATOR,
    );
    const b = await createInvestment(
      { userId: exactly, planId, amount: decimal("50") },
      OPERATOR,
    );

    assert.equal(a.appliedRatePercent, 2, "49.99 is in the band ending at 50");
    assert.equal(b.appliedRatePercent, 3, "50 is in the band starting at 50");
  });

  test("an amount no band covers is refused, and nothing is debited", async () => {
    await setLadder([{ min: 10, max: 50, rate: 2 }, { min: 60, max: null, rate: 5 }]).catch(
      () => undefined,
    );
    // That ladder is invalid (a gap), so it was refused; deactivate a band
    // instead, which is the supported way to create a hole.
    await setLadder([
      { min: 10, max: 50, rate: 2 },
      { min: 50, max: 100, rate: 3, active: false },
      { min: 100, max: null, rate: 5 },
    ]);

    const investor = await makeInvestor("1000");
    const before = await availableFor(investor);

    await assert.rejects(
      () => createInvestment({ userId: investor, planId, amount: decimal("75") }, OPERATOR),
      (error: unknown) =>
        error instanceof InvestmentError && /no rate tier covering/i.test(error.message),
    );

    assert.equal(await availableFor(investor), before, "the balance did not move");
    const rows = await db
      .select({ id: t.investments.id })
      .from(t.investments)
      .where(eq(t.investments.userId, investor));
    assert.equal(rows.length, 0, "no allocation was created");
  });

  test("a plan with no ladder is priced at its own estimated return", async () => {
    await savePlanRateTiers({ planId, tiers: [] }, OPERATOR);
    const investor = await makeInvestor("1000");

    const { appliedRatePercent } = await createInvestment(
      { userId: investor, planId, amount: decimal("75") },
      OPERATOR,
    );
    assert.equal(appliedRatePercent, 8, "the plan's own rate");

    const preview = await previewPlanRate(planId, "75");
    assert.equal(preview.resolved.source, "plan");
    assert.equal(preview.resolved.tierId, null);
  });

  /* ------------------------------------------- historical rate protection -- */

  test("changing a band does not reprice an allocation already made", async () => {
    await setLadder(STANDARD);
    const investor = await makeInvestor("2000");

    const { investmentId } = await createInvestment(
      { userId: investor, planId, amount: decimal("20") },
      OPERATOR,
    );

    const [before] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(before.appliedRatePercent, 2);
    assert.equal(before.projectedProfit, 0.4, "2% of 20");

    // The operator doubles the first band's rate.
    await setLadder([
      { min: 10, max: 50, rate: 4 },
      { min: 50, max: 100, rate: 3 },
      { min: 100, max: null, rate: 5 },
    ]);

    const [after] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    assert.equal(after.appliedRatePercent, 2, "the allocation keeps its rate");
    assert.equal(after.projectedProfit, 0.4, "and its projected profit");
    assert.equal(
      after.appliedTierId,
      before.appliedTierId,
      "and still names the band it was sold at",
    );

    // A *new* allocation gets the new rate.
    const second = await makeInvestor("2000");
    const { appliedRatePercent } = await createInvestment(
      { userId: second, planId, amount: decimal("20") },
      OPERATOR,
    );
    assert.equal(appliedRatePercent, 4, "the new rate applies to new allocations");
  });

  test("deleting a band leaves the allocation that cited it intact", async () => {
    await setLadder(STANDARD);
    const investor = await makeInvestor("2000");

    const { investmentId } = await createInvestment(
      { userId: investor, planId, amount: decimal("20") },
      OPERATOR,
    );
    const [before] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    // Remove the lowest band by widening the one above it to cover the range.
    await savePlanRateTiers(
      {
        planId,
        tiers: [
          { minAmountUsdt: 10, maxAmountUsdt: 100, ratePercent: 3, active: true },
          { minAmountUsdt: 100, maxAmountUsdt: null, ratePercent: 5, active: true },
        ],
      },
      OPERATOR,
    );

    const [after] = await db
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));

    // `applied_tier_id` is deliberately not a foreign key: the evidence
    // survives the band's deletion, which is the whole point of copying it.
    assert.equal(after.appliedTierId, before.appliedTierId);
    assert.equal(after.appliedRatePercent, 2);
    assert.equal(after.projectedProfit, before.projectedProfit);
  });

  /* --------------------------------------------- the safety net around it -- */

  test("an unverified account cannot allocate, whatever the ladder says", async () => {
    await setLadder(STANDARD);
    const investor = await makeInvestor("1000");
    await db
      .update(t.users)
      .set({ kycStatus: "pending_review" })
      .where(eq(t.users.id, investor));

    await assert.rejects(
      () => createInvestment({ userId: investor, planId, amount: decimal("75") }, OPERATOR),
      (error: unknown) =>
        error instanceof InvestmentError && /verification is required/i.test(error.message),
    );
    assert.equal(await availableFor(investor), 1000, "nothing was debited");
  });

  test("an account with allocations frozen cannot allocate", async () => {
    await setLadder(STANDARD);
    const investor = await makeInvestor("1000");
    await db
      .update(t.users)
      .set({ investmentsFrozen: true })
      .where(eq(t.users.id, investor));

    await assert.rejects(
      () => createInvestment({ userId: investor, planId, amount: decimal("75") }, OPERATOR),
      (error: unknown) =>
        error instanceof InvestmentError && /frozen/i.test(error.message),
    );
    assert.equal(await availableFor(investor), 1000);
  });

  test("a closed plan refuses allocations even with a valid ladder", async () => {
    await setLadder(STANDARD);
    const investor = await makeInvestor("1000");
    await db.update(t.plans).set({ status: "closed" }).where(eq(t.plans.id, planId));

    await assert.rejects(
      () => createInvestment({ userId: investor, planId, amount: decimal("75") }, OPERATOR),
      (error: unknown) =>
        error instanceof InvestmentError && /not accepting allocations/i.test(error.message),
    );

    await db.update(t.plans).set({ status: "open" }).where(eq(t.plans.id, planId));
    assert.equal(await availableFor(investor), 1000);
  });

  test("insufficient balance is refused, and nothing at all is written", async () => {
    await setLadder(STANDARD);
    // 20 available, 75 requested.
    const investor = await makeInvestor("20");

    await assert.rejects(
      () => createInvestment({ userId: investor, planId, amount: decimal("75") }, OPERATOR),
      (error: unknown) =>
        error instanceof InvestmentError && /not enough available/i.test(error.message),
    );

    assert.equal(await availableFor(investor), 20, "the balance is untouched");
    const investments = await db
      .select({ id: t.investments.id })
      .from(t.investments)
      .where(eq(t.investments.userId, investor));
    assert.equal(investments.length, 0, "no allocation");
    const commissions = await db
      .select({ id: t.commissionEntries.id })
      .from(t.commissionEntries)
      .where(eq(t.commissionEntries.sourceUserId, investor));
    assert.equal(commissions.length, 0, "no commission accrued");
  });

  test("exactly the available balance is allowed", async () => {
    await setLadder(STANDARD);
    const investor = await makeInvestor("75");

    const { appliedRatePercent } = await createInvestment(
      { userId: investor, planId, amount: decimal("75") },
      OPERATOR,
    );
    assert.equal(appliedRatePercent, 3);
    assert.equal(await availableFor(investor), 0, "spent to the last cent, not refused");
  });

  test("two identical allocations submitted together both take their own money", async () => {
    /*
     * Not a duplicate-submission guard — this codebase has none at the service
     * layer, and deliberately: two allocations of the same size from the same
     * account are a legitimate thing to do. What must hold is that the *money*
     * is right. With 100 available and two 75s racing, one succeeds and one is
     * refused by the `available + delta >= 0` clause, and the balance can never
     * go negative.
     */
    await setLadder(STANDARD);
    const investor = await makeInvestor("100");

    const results = await Promise.allSettled([
      createInvestment({ userId: investor, planId, amount: decimal("75") }, OPERATOR),
      createInvestment({ userId: investor, planId, amount: decimal("75") }, OPERATOR),
    ]);

    const succeeded = results.filter((result) => result.status === "fulfilled").length;
    assert.equal(succeeded, 1, "only one of the two could be afforded");
    assert.equal(await availableFor(investor), 25, "100 − 75, never −50");
  });

  async function availableFor(userId: string): Promise<number> {
    const [row] = await db
      .select({ available: t.walletBalances.available })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return row.available;
  }
});
