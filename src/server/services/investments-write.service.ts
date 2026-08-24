import "server-only";

import { eq, sql } from "drizzle-orm";

import { compare, decimalFrom, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";

import { applyLedgerEntry, readBalance } from "../repositories/wallet.repository";
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
      elapsedDays: 0,
      status: "active",
      rewardFrequency: plan.rewardFrequency,
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

    audit({
      action: "user_updated",
      target: { type: "user", id: request.userId, label: request.userId },
      details: `Allocated ${request.amount} USDT to ${plan.name}.`,
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
