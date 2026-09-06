import "server-only";

import { eq, sql } from "drizzle-orm";

import { negate, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";

import {
  applyLedgerEntry,
  ensureWallet,
  readBalance,
  type BalanceBucket,
} from "../repositories/wallet.repository";
import { mutate, newId, SYSTEM_ACTOR, type Actor } from "../write";

/**
 * Wallet movements.
 *
 * Every function here is a *use case* — "credit a reward", "hold funds for an
 * allocation" — rather than a generic "set the balance". That is deliberate:
 * a generic setter has no description to put in the ledger and no reason to put
 * in the audit trail, and the first caller in a hurry would leave both blank.
 */

export interface CreditRequest {
  userId: string;
  amount: Decimal;
  description: string;
  reference?: string | null;
  buckets?: Partial<Record<BalanceBucket, Decimal>>;
}

/** Credits a wallet and records why. */
export async function creditWallet(
  request: CreditRequest & { type: "deposit" | "reward" | "referral" },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ ledgerTxId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    await ensureWallet(tx, request.userId);

    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: request.userId,
      type: request.type,
      amount: request.amount,
      description: request.description,
      reference: request.reference ?? null,
      occurredAt: now,
      buckets: request.buckets,
    });

    audit({
      action: "deposit_credited",
      target: { type: "user", id: request.userId, label: request.userId },
      details: `Credited ${request.amount} USDT. ${request.description}`,
    });

    return { ledgerTxId };
  });
}

/** Debits a wallet. Refuses rather than overdrawing — see the repository. */
export async function debitWallet(
  request: CreditRequest & { type: "withdrawal" | "investment" },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ ledgerTxId: string }> {
  return mutate(actor, async ({ tx, now }) => {
    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: request.userId,
      type: request.type,
      amount: negate(request.amount),
      description: request.description,
      reference: request.reference ?? null,
      occurredAt: now,
      buckets: request.buckets,
    });
    return { ledgerTxId };
  });
}

/**
 * Records an investment earning and credits it, once.
 *
 * `periodKey` is what makes "once" true: a unique index on
 * (investment_id, period_key) means a scheduler that fires twice, or is
 * replayed after a crash, inserts nothing the second time. The check is the
 * database's, not a prior `SELECT` — two concurrent runs would both pass that.
 *
 * `periodIndex` — the 1-based position this period holds in the allocation's
 * own schedule (`investment-schedule.ts`'s `EarningPeriod.index`) — advances
 * `investments.earnings_credited_periods`, the cursor `creditDueEarnings` uses
 * to know which period is next. `greatest(…)` rather than a plain increment:
 * two concurrent settlement attempts crediting different periods out of order
 * must not walk the cursor backwards, and a replayed call for an
 * already-credited period (which reaches this function only when something
 * retries after its own crash, since `creditDueEarnings` itself only ever
 * asks for periods past the cursor) must not move it at all.
 */
export async function recordInvestmentEarning(
  request: {
    investmentId: string;
    userId: string;
    amount: Decimal;
    periodKey: string;
    periodIndex: number;
    planName: string;
  },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ credited: boolean; ledgerTxId: string | null }> {
  return mutate(actor, async ({ tx, now }) => {
    const inserted = await tx
      .insert(t.investmentEarnings)
      .values({
        id: newId("ern", now),
        investmentId: request.investmentId,
        userId: request.userId,
        amount: numericValue(request.amount),
        periodKey: request.periodKey,
        earnedAt: now,
      })
      .onConflictDoNothing({
        target: [t.investmentEarnings.investmentId, t.investmentEarnings.periodKey],
      })
      .returning({ id: t.investmentEarnings.id });

    if (inserted.length === 0) {
      // Already settled for this period. Not an error — the correct outcome of
      // a retry — so the transaction commits having changed nothing.
      return { credited: false, ledgerTxId: null };
    }

    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: request.userId,
      type: "reward",
      amount: request.amount,
      description: `Reward · ${request.planName}`,
      reference: inserted[0].id,
      occurredAt: now,
      buckets: { totalProfit: request.amount },
    });

    await tx
      .update(t.investmentEarnings)
      .set({ creditedAt: now, ledgerTxId })
      .where(eq(t.investmentEarnings.id, inserted[0].id));

    // The allocation's own running profit and its credited-period cursor,
    // both added/advanced in Postgres like every other money value.
    await tx
      .update(t.investments)
      .set({
        profit: sql`${t.investments.profit} + ${request.amount}::numeric`,
        earningsCreditedPeriods: sql`greatest(${t.investments.earningsCreditedPeriods}, ${request.periodIndex})`,
        updatedAt: now,
      })
      .where(eq(t.investments.id, request.investmentId));

    return { credited: true, ledgerTxId };
  });
}

/** Reads a balance exactly, for callers that must compare amounts. */
export async function getExactBalance(userId: string) {
  return mutate(SYSTEM_ACTOR, async ({ tx }) => readBalance(tx, userId));
}
