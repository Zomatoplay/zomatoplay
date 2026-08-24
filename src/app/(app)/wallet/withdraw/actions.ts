"use server";

import { decimal, MoneyError, type Decimal } from "@/db/money";
import {
  MIN_WITHDRAWAL_USDT,
  WITHDRAWAL_FEE_PERCENT,
  WITHDRAWAL_FEE_USDT,
} from "@/constants/app";
import { getUsdtInrPayoutRate } from "@/lib/currency";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { trackPipeline } from "@/server/observability";
import { traceAction } from "@/server/trace-action";
import { revalidate } from "@/server/revalidate";
import { requestWithdrawal } from "@/server/services/withdrawals-write.service";
import type { Actor } from "@/server/write";

/**
 * Requesting a withdrawal.
 *
 * THE QUOTE IS BUILT HERE, NOT ACCEPTED FROM THE BROWSER
 * ------------------------------------------------------
 * The client sends an amount and a destination. It does not send the fee, the
 * rate or the net INR, because those decide what the platform owes: a request
 * body carrying `totalFeeUsdt: 0` would otherwise be honoured. The fee model
 * lives in `@/constants/app` and is applied on both sides, so the figure the
 * user was shown and the figure that is stored come from the same rules — and
 * the stored one is the one computed where it cannot be edited.
 *
 * NOTHING IS PAID
 * ---------------
 * This creates a record and holds the balance. There is no payout rail (§17.4).
 * An operator works the request in the CRM; approving it records a decision.
 */
export interface WithdrawResult {
  ok: boolean;
  message: string;
  withdrawalId?: string;
}

/** Rounds to the scale the `numeric(20, 8)` / `numeric(20, 2)` columns store. */
function money(value: number, scale: number): Decimal {
  return decimal(value.toFixed(scale));
}

export async function requestWithdrawalAction(input: {
  amount: string;
  bankAccountId: string;
}): Promise<WithdrawResult> {
  return traceAction(
    { name: "withdrawal.request", actorType: "user", pipeline: "withdrawal" },
    () => runRequestWithdrawal(input),
  );
}

async function runRequestWithdrawal(input: {
  amount: string;
  bankAccountId: string;
}): Promise<WithdrawResult> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  const amountNumber = Number.parseFloat(input.amount);
  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return { ok: false, message: "Enter a valid amount." };
  }
  if (amountNumber < MIN_WITHDRAWAL_USDT) {
    return {
      ok: false,
      message: `The minimum withdrawal is ${MIN_WITHDRAWAL_USDT} USDT.`,
    };
  }

  const payoutRate = getUsdtInrPayoutRate().rate;
  const percentFee = (amountNumber * WITHDRAWAL_FEE_PERCENT) / 100;
  const totalFee = WITHDRAWAL_FEE_USDT + percentFee;
  const netUsdt = Math.max(amountNumber - totalFee, 0);

  if (netUsdt <= 0) {
    return { ok: false, message: "Fees exceed the amount requested." };
  }

  try {
    const quote = {
      amountUsdt: money(amountNumber, 8),
      payoutRate: money(payoutRate, 6),
      flatFeeUsdt: money(WITHDRAWAL_FEE_USDT, 8),
      percentFeeUsdt: money(percentFee, 8),
      totalFeeUsdt: money(totalFee, 8),
      netInr: money(netUsdt * payoutRate, 2),
    };

    const actor: Actor = {
      kind: "user",
      id: account.userId,
      name: account.fullName || account.email,
      role: "agent",
    };

    const { withdrawalId } = await trackPipeline(
        {
          pipeline: "withdrawal",
          operation: "withdrawal.request.write",
          message: "User requested a payout; balance held",
          userId: account.userId,
          actor,
          metadata: { amountUsdt: amountNumber, netInr: netUsdt * payoutRate },
        },
      () =>
        requestWithdrawal(
          { userId: account.userId, quote, bankAccountId: input.bankAccountId },
          actor,
        ),
    );

    revalidate("/wallet", "/wallet/transactions", "/");
    return { ok: true, message: "Withdrawal requested.", withdrawalId };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof MoneyError
          ? error.message
          : error instanceof Error
            ? error.message
            : "The request was not created.",
    };
  }
}
