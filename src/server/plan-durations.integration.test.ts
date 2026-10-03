import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal } from "@/db/money";
import * as t from "@/db/schema";

import { createInvestment } from "./services/investments-write.service";
import { settleInvestments } from "./services/investment-settlement.service";
import { savePlanDurationRates } from "./services/plan-duration-rates-write.service";
import { newId, type Actor } from "./write";

/**
 * Selectable durations end to end, against the real database: an operator
 * sets per-duration rates, a customer allocates on a 15-day term, and the
 * settlement engine pays 7/15, 7/15 and 1/15 of the profit — the last at
 * maturity — then returns the principal. Uses its own scratch plan, so the
 * public catalogue is untouched.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = { kind: "agent", id: "agt_duration_test", name: "Duration Test", role: "master_admin" };
const DAY = 24 * 60 * 60 * 1000;

describe("plan durations", { skip }, () => {
  let db: Database;
  const planId = newId("plan_durtest");
  const users: string[] = [];

  before(async () => {
    db = createAdminDb();
    await db.insert(t.plans).values({
      id: planId,
      slug: planId,
      name: "Duration Test Plan",
      tagline: "test",
      description: "test",
      minInvestment: 10,
      maxInvestment: 10000,
      durationDays: 30,
      estimatedReturnPercent: 5,
      estimatedReturnLow: 5,
      estimatedReturnHigh: 5,
      rewardFrequency: "daily",
      risk: "balanced",
      status: "open",
      earlyExit: "test",
    });
  });

  after(async () => {
    for (const id of users) await db.delete(t.users).where(eq(t.users.id, id));
    await db.delete(t.plans).where(eq(t.plans.id, planId));
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser(available: number) {
    const id = newId("usr_durtest");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-D${suffix}`,
      fullName: `Duration ${suffix}`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      referralCode: `DT${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id, available });
    users.push(id);
    return id;
  }

  test("an operator's rates are saved per duration, validated, and audited", async () => {
    await assert.rejects(
      savePlanDurationRates({ planId, rates: [{ durationDays: 14, ratePercent: "1" }] }, OPERATOR),
      /not a selectable duration/,
    );
    await assert.rejects(
      savePlanDurationRates({ planId, rates: [{ durationDays: 7, ratePercent: "0" }] }, OPERATOR),
      /above 0/,
    );
    const { offered } = await savePlanDurationRates(
      {
        planId,
        rates: [
          { durationDays: 7, ratePercent: "1" },
          { durationDays: 15, ratePercent: "3" },
          { durationDays: 30, ratePercent: "" },
          { durationDays: 60, ratePercent: "8.5" },
          { durationDays: 90, ratePercent: "12" },
        ],
      },
      OPERATOR,
    );
    assert.equal(offered, 4);
    const rows = await db
      .select()
      .from(t.planDurationRates)
      .where(eq(t.planDurationRates.planId, planId))
      .orderBy(asc(t.planDurationRates.durationDays));
    assert.deepEqual(rows.map((r) => [r.durationDays, r.ratePercent]), [[7, 1], [15, 3], [60, 8.5], [90, 12]]);
    const audits = await db.select().from(t.auditLogs).where(eq(t.auditLogs.targetId, planId));
    assert.ok(audits.some((a) => /15d not offered → 3%/.test(a.details)));
  });

  test("a duration is required, and one with no rate is refused — no rate is ever derived", async () => {
    const userId = await makeUser(1000);
    await assert.rejects(
      createInvestment({ userId, planId, amount: decimal("100") }),
      /Choose how long/,
    );
    await assert.rejects(
      createInvestment({ userId, planId, amount: decimal("100"), durationDays: 30 }),
      /isn't available/,
    );
    const [balance] = await db.select().from(t.walletBalances).where(eq(t.walletBalances.userId, userId));
    assert.equal(balance.available, 1000, "nothing was debited");
  });

  test("15 days: term and rate are stored, then paid 7/15, 7/15, 1/15 and matured — never more", async () => {
    const userId = await makeUser(1000);
    const { investmentId, appliedRatePercent } = await createInvestment({
      userId,
      planId,
      amount: decimal("300"),
      durationDays: 15,
    });
    assert.equal(appliedRatePercent, 3);

    const [row] = await db.select().from(t.investments).where(eq(t.investments.id, investmentId));
    assert.equal(row.durationDays, 15);
    assert.equal(row.scheduleVersion, 2);
    assert.equal(row.rewardFrequency, "weekly");
    assert.equal(row.appliedRatePercent, 3);
    assert.ok(row.appliedDurationRateId);
    assert.equal(row.projectedProfit, 9, "3% of 300");
    assert.equal(row.maturesAt.getTime() - row.startedAt.getTime(), 15 * DAY);

    // A later rate change does not reach this allocation.
    await savePlanDurationRates({ planId, rates: [{ durationDays: 15, ratePercent: "99" }] }, OPERATOR);

    // Backdate the whole term (start and maturity together) so everything is due.
    const shift = sql`interval '16 days'`;
    await db
      .update(t.investments)
      .set({ startedAt: sql`${t.investments.startedAt} - ${shift}`, maturesAt: sql`${t.investments.maturesAt} - ${shift}` })
      .where(eq(t.investments.id, investmentId));

    await settleInvestments();
    await settleInvestments(); // a replay pays nothing twice

    const earnings = await db
      .select({ key: t.investmentEarnings.periodKey, amount: sql<string>`${t.investmentEarnings.amount}::text` })
      .from(t.investmentEarnings)
      .where(eq(t.investmentEarnings.investmentId, investmentId))
      .orderBy(asc(t.investmentEarnings.periodKey));
    assert.deepEqual(
      earnings.map((e) => [e.key, decimal(e.amount)]),
      [["p1", "4.2"], ["p2", "4.2"], ["p3", "0.6"]],
    );

    const [after] = await db.select().from(t.investments).where(eq(t.investments.id, investmentId));
    assert.equal(after.status, "matured");
    assert.equal(after.profit, 9, "exactly the projected profit, nothing beyond maturity");

    const [balance] = await db.select().from(t.walletBalances).where(eq(t.walletBalances.userId, userId));
    assert.equal(balance.available, 1009, "principal back plus 9 profit");
    assert.equal(balance.lockedInInvestments, 0);
  });
});
