import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { compare, decimalFrom, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";

import { applyLedgerEntry, readBalance } from "../repositories/wallet.repository";
import { mutate, newId, withReason, type Actor } from "../write";

/**
 * Withdrawals — **as database records only**.
 *
 * NOTHING HERE MOVES MONEY OFF THE PLATFORM.
 *
 * There is no payout rail, no bank integration and no on-chain send. A
 * withdrawal request holds the user's balance and creates a row for an operator
 * to work; approving it and marking it paid are bookkeeping entries that record
 * a decision, not instructions that cause a transfer. `payoutReference` is
 * whatever the operator types.
 *
 * That distinction is written here because the status vocabulary
 * (`approved`, `processing`, `paid`) reads exactly like a system that pays
 * people, and the next person to touch this file should not have to infer from
 * the absence of an HTTP client that it does not.
 *
 * The one thing that *is* real: requesting a withdrawal debits the wallet
 * immediately, so a user cannot spend the same balance twice while a request is
 * outstanding. Rejecting one returns it.
 */

export class WithdrawalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithdrawalError";
  }
}

export interface WithdrawalQuoteInput {
  amountUsdt: Decimal;
  payoutRate: Decimal;
  flatFeeUsdt: Decimal;
  percentFeeUsdt: Decimal;
  totalFeeUsdt: Decimal;
  netInr: Decimal;
}

export async function requestWithdrawal(
  request: {
    userId: string;
    quote: WithdrawalQuoteInput;
    bankAccountId: string;
  },
  actor: Actor,
): Promise<{ withdrawalId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const [user] = await tx
      .select({
        id: t.users.id,
        kycStatus: t.users.kycStatus,
        withdrawalsFrozen: t.users.withdrawalsFrozen,
      })
      .from(t.users)
      .where(eq(t.users.id, request.userId))
      .limit(1);
    if (!user) throw new WithdrawalError(`No user ${request.userId}.`);
    if (user.withdrawalsFrozen) {
      throw new WithdrawalError("Withdrawals are frozen on this account.");
    }
    if (user.kycStatus !== "verified") {
      throw new WithdrawalError("Verification is required before withdrawing.");
    }

    const [bank] = await tx
      .select()
      .from(t.bankAccounts)
      .where(
        and(
          eq(t.bankAccounts.id, request.bankAccountId),
          eq(t.bankAccounts.userId, request.userId),
        ),
      )
      .limit(1);
    if (!bank) throw new WithdrawalError("That payout destination is not on file.");

    const balance = await readBalance(tx, request.userId);
    if (!balance || compare(balance.available, request.quote.amountUsdt) < 0) {
      throw new WithdrawalError("Not enough available balance.");
    }

    const withdrawalId = newId("wd", now);

    await tx.insert(t.withdrawals).values({
      id: withdrawalId,
      userId: request.userId,
      amountUsdt: numericValue(request.quote.amountUsdt),
      // The rate is stored because it was quoted to the user at this moment.
      // Recomputing it later would change what they were promised.
      payoutRate: numericValue(request.quote.payoutRate),
      flatFeeUsdt: numericValue(request.quote.flatFeeUsdt),
      percentFeeUsdt: numericValue(request.quote.percentFeeUsdt),
      totalFeeUsdt: numericValue(request.quote.totalFeeUsdt),
      netInr: numericValue(request.quote.netInr),
      destinationLabel: bank.label,
      destinationBankName: bank.bankName,
      destinationAccountMasked: bank.accountNumberMasked,
      destinationIfsc: bank.ifsc,
      destinationHolderName: bank.holderName,
      requestedAt: now,
      status: "pending",
    });

    // Held now, so the same balance cannot back two requests.
    await applyLedgerEntry(tx, {
      userId: request.userId,
      type: "withdrawal",
      amount: `-${request.quote.amountUsdt}` as Decimal,
      status: "processing",
      description: `Withdrawal to ${bank.bankName} ${bank.accountNumberMasked}`,
      reference: withdrawalId,
      inrAmount: request.quote.netInr,
      feeUsdt: request.quote.totalFeeUsdt,
      occurredAt: now,
      buckets: { totalWithdrawn: request.quote.amountUsdt },
    });

    audit({
      action: "withdrawal_approved",
      target: { type: "withdrawal", id: withdrawalId, label: withdrawalId },
      details: `Requested ${request.quote.amountUsdt} USDT to ${bank.bankName}. Held pending review.`,
    });

    return { withdrawalId };
  });
}

/** Records an approval decision. Does not pay anyone. */
export async function approveWithdrawal(
  request: { withdrawalId: string; note?: string },
  actor: Actor,
): Promise<void> {
  return transition(request.withdrawalId, actor, {
    from: ["pending", "under_review"],
    to: "approved",
    action: "withdrawal_approved",
    details: "Approved for payout.",
    note: request.note,
  });
}

/** Records that an operator sent the money by some means outside this system. */
export async function markWithdrawalPaid(
  request: { withdrawalId: string; payoutReference?: string },
  actor: Actor,
): Promise<void> {
  return transition(request.withdrawalId, actor, {
    from: ["approved", "processing"],
    to: "paid",
    action: "withdrawal_marked_paid",
    details: "Marked as paid.",
    note: request.payoutReference,
    apply: (now) => ({ settledAt: now, payoutReference: request.payoutReference ?? null }),
  });
}

/**
 * Rejects a request and returns the held balance.
 *
 * The refund is a ledger entry like any other, so the history shows the hold
 * and its reversal rather than a balance that silently returned.
 */
export async function rejectWithdrawal(
  request: { withdrawalId: string; reason: string },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const [withdrawal] = await tx
      .select()
      .from(t.withdrawals)
      .where(eq(t.withdrawals.id, request.withdrawalId))
      .limit(1)
      .for("update");

    if (!withdrawal) throw new WithdrawalError(`No withdrawal ${request.withdrawalId}.`);
    if (withdrawal.status === "paid") {
      throw new WithdrawalError("That withdrawal has already been paid.");
    }
    if (withdrawal.status === "rejected") return;

    const amount = decimalFrom(withdrawal.amountUsdt);

    const updated = await tx
      .update(t.withdrawals)
      .set({
        status: "rejected",
        rejectionReason: request.reason,
        reviewedBy: actor.name,
        settledAt: now,
      })
      .where(
        sql`${t.withdrawals.id} = ${withdrawal.id} and ${t.withdrawals.status} <> 'rejected'`,
      )
      .returning({ id: t.withdrawals.id });

    if (updated.length === 0) return;

    await applyLedgerEntry(tx, {
      userId: withdrawal.userId,
      type: "withdrawal",
      amount,
      description: "Withdrawal rejected — funds returned",
      reference: withdrawal.id,
      occurredAt: now,
      buckets: { totalWithdrawn: `-${amount}` as Decimal },
    });

    audit({
      action: "withdrawal_rejected",
      target: { type: "withdrawal", id: withdrawal.id, label: withdrawal.id },
      details: withReason(`Rejected; ${amount} USDT returned to available.`, request.reason),
    });
  });
}

/** Shared status move, guarded so a repeated click cannot double-apply. */
async function transition(
  withdrawalId: string,
  actor: Actor,
  options: {
    from: (typeof t.withdrawalStatusEnum.enumValues)[number][];
    to: (typeof t.withdrawalStatusEnum.enumValues)[number];
    action: "withdrawal_approved" | "withdrawal_marked_paid" | "withdrawal_rejected";
    details: string;
    note?: string;
    apply?: (now: Date) => Record<string, unknown>;
  },
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const updated = await tx
      .update(t.withdrawals)
      .set({
        status: options.to,
        reviewedBy: actor.name,
        ...(options.apply?.(now) ?? {}),
      })
      // `inArray`, not a hand-built `in ${array}`: drizzle binds an array as a
      // single parameter, which Postgres reads as an array value rather than a
      // list, and the comparison silently matches nothing.
      .where(
        and(
          eq(t.withdrawals.id, withdrawalId),
          inArray(t.withdrawals.status, options.from),
        ),
      )
      .returning({ id: t.withdrawals.id });

    if (updated.length === 0) {
      throw new WithdrawalError(
        `That withdrawal is not in a state that can become ${options.to}.`,
      );
    }

    audit({
      action: options.action,
      target: { type: "withdrawal", id: withdrawalId, label: withdrawalId },
      details: withReason(options.details, options.note),
    });
  });
}
