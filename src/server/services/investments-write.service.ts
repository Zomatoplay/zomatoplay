import "server-only";

import { eq, sql } from "drizzle-orm";

import { compare, decimalFrom, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import { getDb } from "@/db";

import { applyLedgerEntry, readBalance } from "../repositories/wallet.repository";
import { accrueReferralCommission } from "./referrals-write.service";
import { elapsedDaysFor, isOpenEnded, rewardScheduleFor } from "./investment-schedule";
import { mutate, newId, withReason, SYSTEM_ACTOR, type Actor } from "../write";

/**
 * Allocations into plans.
 *
 * Creating one moves money: `available` falls, `totalInvested` and
 * `lockedInInvestments` rise, and a ledger entry records it — all in the
 * transaction that writes the investment row. The plan's own aggregate moves
 * with it, so the CRM's plan cards do not need to sum the allocation table on
 * every render.
 */

export class InvestmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvestmentError";
  }
}

export async function createInvestment(
  request: { userId: string; planId: string; amount: Decimal },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ investmentId: string; ledgerTxId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const [plan] = await tx
      .select()
      .from(t.plans)
      .where(eq(t.plans.id, request.planId))
      .limit(1);
    if (!plan) throw new InvestmentError(`No plan ${request.planId}.`);
    if (plan.status === "closed" || plan.status === "disabled") {
      throw new InvestmentError(`${plan.name} is not accepting allocations.`);
    }

    const [user] = await tx
      .select({
        id: t.users.id,
        // Read here rather than in the referral service: it is one column on a
        // row this transaction already has to fetch, and the alternative is a
        // second round trip inside a transaction holding a connection.
        fullName: t.users.fullName,
        kycStatus: t.users.kycStatus,
        investmentsFrozen: t.users.investmentsFrozen,
      })
      .from(t.users)
      .where(eq(t.users.id, request.userId))
      .limit(1);
    if (!user) throw new InvestmentError(`No user ${request.userId}.`);
    if (user.investmentsFrozen) {
      throw new InvestmentError("Allocations are frozen on this account.");
    }
    // The same gate the UI applies, enforced where it cannot be skipped.
    if (user.kycStatus !== "verified") {
      throw new InvestmentError("Verification is required before investing.");
    }

    // Compared as exact decimals, never as floats.
    const minimum = decimalFrom(plan.minInvestment);
    const maximum = decimalFrom(plan.maxInvestment);
    if (compare(request.amount, minimum) < 0) {
      throw new InvestmentError(`${plan.name} has a minimum of ${minimum} USDT.`);
    }
    if (compare(request.amount, maximum) > 0) {
      throw new InvestmentError(`${plan.name} has a maximum of ${maximum} USDT.`);
    }

    const balance = await readBalance(tx, request.userId);
    if (!balance || compare(balance.available, request.amount) < 0) {
      throw new InvestmentError("Not enough available balance.");
    }

    const investmentId = newId("inv", now);
    const maturesAt = new Date(now);
    maturesAt.setUTCDate(maturesAt.getUTCDate() + plan.durationDays);

    /*
     * The projected profit, computed here as well as in the insert below.
     *
     * The column is written by Postgres from exact `numeric` — that is the
     * value of record. This JavaScript copy exists only to derive the *reward
     * schedule*, which is a forecast rather than a balance, and the alternative
     * is a second round trip to read back what was just written.
     */
    const projectedProfit = Number(request.amount) * (plan.estimatedReturnPercent / 100);

    /*
     * The schedule was never stamped, and that was a real gap.
     *
     * Every seeded allocation carries `next_reward_at` and
     * `next_reward_amount`; every allocation a real user made carried neither,
     * because this insert left both null. The allocation card therefore showed
     * "next reward —" for ever on exactly the rows a person had paid into,
     * while the demo rows looked correct. See `./investment-schedule`.
     */
    const schedule = rewardScheduleFor(
      {
        startedAt: now,
        maturesAt,
        durationDays: plan.durationDays,
        projectedProfit,
        rewardFrequency: plan.rewardFrequency,
      },
      now,
    );

    await tx.insert(t.investments).values({
      id: investmentId,
      userId: request.userId,
      planId: plan.id,
      // The plan's terms are copied, not joined: editing a plan later must not
      // rewrite what an existing allocation was sold as.
      planName: plan.name,
      amount: numericValue(request.amount),
      projectedProfit: sql`${request.amount}::numeric * ${plan.estimatedReturnPercent}::numeric / 100`,
      startedAt: now,
      maturesAt,
      durationDays: plan.durationDays,
      elapsedDays: elapsedDaysFor({ startedAt: now, durationDays: plan.durationDays }, now),
      status: "active",
      rewardFrequency: plan.rewardFrequency,
      nextRewardAt: schedule.nextRewardAt,
      nextRewardAmount: schedule.nextRewardAmount,
      risk: plan.risk,
      createdAt: now,
      updatedAt: now,
    });

    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: request.userId,
      type: "investment",
      amount: `-${request.amount}` as Decimal,
      description: `Allocation · ${plan.name}`,
      reference: investmentId,
      occurredAt: now,
      buckets: {
        totalInvested: request.amount,
        lockedInInvestments: request.amount,
      },
    });

    await tx
      .update(t.plans)
      .set({
        activeInvestments: sql`${t.plans.activeInvestments} + 1`,
        totalAllocated: sql`${t.plans.totalAllocated} + ${request.amount}::numeric`,
        updatedAt: now,
      })
      .where(eq(t.plans.id, plan.id));

    /*
     * Commission, in the same transaction as the allocation that earned it.
     *
     * Not a follow-up write and not a scheduled job: a commission entry whose
     * allocation rolled back is an unbacked promise of money, and an allocation
     * whose commission failed silently is a programme the referrer can never
     * reconcile. Either both land or neither does.
     *
     * Nothing is credited to anybody's balance here — see the note at the top
     * of `referrals-write.service`. Entries are `pending`.
     */
    const accruals = await accrueReferralCommission(tx, {
      investorUserId: request.userId,
      investorName: user.fullName,
      planName: plan.name,
      amount: request.amount,
      now,
    });

    audit({
      action: "user_updated",
      target: { type: "user", id: request.userId, label: request.userId },
      details:
        accruals.length > 0
          ? `Allocated ${request.amount} USDT to ${plan.name}. Accrued pending referral ` +
            `commission for ${accruals.length} beneficiar${accruals.length === 1 ? "y" : "ies"}.`
          : `Allocated ${request.amount} USDT to ${plan.name}.`,
    });

    return { investmentId, ledgerTxId };
  });
}

/**
 * Matures an allocation: principal leaves the lock and returns to `available`.
 *
 * Guarded on `status = 'active'` in the `WHERE`, so a scheduler that runs twice
 * returns the principal once.
 */
export async function matureInvestment(
  request: { investmentId: string; note?: string },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ matured: boolean }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const [investment] = await tx
      .select()
      .from(t.investments)
      .where(eq(t.investments.id, request.investmentId))
      .limit(1)
      .for("update");

    if (!investment) throw new InvestmentError(`No investment ${request.investmentId}.`);
    if (investment.status !== "active") return { matured: false };

    const principal = decimalFrom(investment.amount);

    const updated = await tx
      .update(t.investments)
      .set({
        status: "matured",
        nextRewardAt: null,
        nextRewardAmount: null,
        updatedAt: now,
      })
      .where(
        sql`${t.investments.id} = ${investment.id} and ${t.investments.status} = 'active'`,
      )
      .returning({ id: t.investments.id });

    if (updated.length === 0) return { matured: false };

    await applyLedgerEntry(tx, {
      userId: investment.userId,
      type: "investment",
      amount: principal,
      description: `Principal returned · ${investment.planName}`,
      reference: investment.id,
      occurredAt: now,
      buckets: { lockedInInvestments: `-${principal}` as Decimal },
    });

    await tx
      .update(t.plans)
      .set({
        activeInvestments: sql`greatest(${t.plans.activeInvestments} - 1, 0)`,
        updatedAt: now,
      })
      .where(eq(t.plans.id, investment.planId));

    audit({
      action: "user_updated",
      target: { type: "user", id: investment.userId, label: investment.userId },
      details: withReason(
        `Matured ${investment.planName}; ${principal} USDT returned to available.`,
        request.note,
      ),
    });

    return { matured: true };
  });
}

/**
 * Ends an open-ended allocation at the customer's request.
 *
 * THE PRODUCT DEFINES THIS, AND SAYS SO FOUR TIMES
 * ------------------------------------------------
 * Flexible Reserve (`duration_days: 0`) is sold on exactly this:
 *
 *   tagline      "Withdraw any time"
 *   howItWorks   "You can return funds to your available balance at any time."
 *   conditions   "No lock-in period — funds can be returned to your available
 *                 balance at any time."
 *   earlyExit    "No lock-in. Funds can be returned to your available balance
 *                 instantly."
 *
 * No fee and no forfeiture, unlike the fixed-term plans, which name theirs
 * ("a 2% exit fee on principal", "forfeiture of accrued rewards"). So the rule
 * here is the simple one the copy promises: the whole principal, immediately.
 *
 * **Only open-ended allocations.** The fixed-term plans define early exit with
 * arithmetic of their own, and none of it is implemented; refusing them here is
 * not an oversight but the absence of a rule this function is entitled to
 * invent.
 *
 * WHY IT DELEGATES RATHER THAN REIMPLEMENTS
 * -----------------------------------------
 * `matureInvestment` already does the money: principal back to `available`,
 * released from `locked_in_investments`, ledger entry, plan aggregate, audit,
 * all in one transaction guarded on `status = 'active'`. Writing a second copy
 * of that would be a second place for the ledger to drift. This adds only the
 * three checks a *customer-initiated* exit needs on top of it.
 *
 * The checks read outside that transaction, which is safe because none of them
 * can change underneath: ownership and `duration_days` are immutable, and the
 * only racy condition — is it still active — is re-asserted inside
 * `matureInvestment`'s own `UPDATE`. Two clicks return the principal once.
 */
export async function endOpenEndedInvestment(
  request: { investmentId: string; userId: string },
  actor: Actor,
): Promise<{ ended: boolean; amount: Decimal }> {
  const db = getDb();

  const [investment] = await db
    .select({
      id: t.investments.id,
      userId: t.investments.userId,
      amount: t.investments.amount,
      status: t.investments.status,
      durationDays: t.investments.durationDays,
      planName: t.investments.planName,
    })
    .from(t.investments)
    .where(eq(t.investments.id, request.investmentId))
    .limit(1);

  /*
   * "Not found" and "not yours" are the same answer, deliberately.
   *
   * A distinct message would tell somebody probing ids which ones exist.
   */
  if (!investment || investment.userId !== request.userId) {
    throw new InvestmentError("That allocation was not found on your account.");
  }

  if (!isOpenEnded(investment.durationDays)) {
    throw new InvestmentError(
      `${investment.planName} has a fixed term and cannot be ended early.`,
    );
  }

  if (investment.status !== "active") {
    throw new InvestmentError("That allocation has already ended.");
  }

  /*
   * The operator's switch, honoured.
   *
   * `/admin/settings` offers "allow early exit", and a setting the product
   * ignores is worse than one that is not there — the same defect the referral
   * programme's own switches had. Absent settings row: the documented default
   * is on, so a missing row must not silently freeze everybody's funds.
   */
  const [settings] = await db
    .select({ investments: t.platformSettings.investments })
    .from(t.platformSettings)
    .where(eq(t.platformSettings.id, "default"))
    .limit(1);

  if (settings?.investments?.allowEarlyExit === false) {
    throw new InvestmentError(
      "Returning funds from an allocation is temporarily unavailable. Contact support.",
    );
  }

  const { matured } = await matureInvestment(
    { investmentId: investment.id, note: "Returned at the customer's request." },
    actor,
  );

  return { ended: matured, amount: decimalFrom(investment.amount) };
}
