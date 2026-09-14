"use server";

import {
  add,
  applyPercent,
  compare,
  decimal,
  isPositive,
  MoneyError,
  multiplyByRate,
  subtract,
  type Decimal,
} from "@/db/money";
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

/** INR is stored `numeric(20, 2)`; there is no such thing as a fraction of a paisa. */
const INR_SCALE = 2;

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

  /*
   * EXACT FROM HERE DOWN — NO JAVASCRIPT NUMBER TOUCHES A MONEY VALUE.
   *
   * This used to parse the amount with `Number.parseFloat`, compute the fees
   * and the net with `*`, `/` and `-`, and round the results afterwards. That
   * breaks the rule CLAUDE.md §17.2 calls the most important one, on the one
   * screen that quotes a customer what they will be paid — and rounding a
   * wrong number does not make it right. The amount is parsed straight into a
   * `Decimal`, which validates it, and every figure below is derived with the
   * exact-integer helpers in `@/db/money`.
   */
  let amount: Decimal;
  try {
    amount = decimal(input.amount.trim());
  } catch {
    return { ok: false, message: "Enter a valid amount." };
  }
  if (!isPositive(amount)) {
    return { ok: false, message: "Enter a valid amount." };
  }

  const minimum = decimal(MIN_WITHDRAWAL_USDT);
  if (compare(amount, minimum) < 0) {
    return {
      ok: false,
      message: `The minimum withdrawal is ${MIN_WITHDRAWAL_USDT} USDT.`,
    };
  }

  const payoutRate = decimal(getUsdtInrPayoutRate().rate);
  const flatFee = decimal(WITHDRAWAL_FEE_USDT);
  const percentFee = applyPercent(amount, decimal(WITHDRAWAL_FEE_PERCENT));
  const totalFee = add(flatFee, percentFee);
  const netUsdt = subtract(amount, totalFee);

  // Not `Math.max(…, 0)`: a fee larger than the amount is a refusal, not a
  // zero. Clamping it would have quoted a payout of ₹0 as if it were valid.
  if (!isPositive(netUsdt)) {
    return { ok: false, message: "Fees exceed the amount requested." };
  }

  try {
    const quote = {
      amountUsdt: amount,
      payoutRate,
      flatFeeUsdt: flatFee,
      percentFeeUsdt: percentFee,
      totalFeeUsdt: totalFee,
      netInr: multiplyByRate(netUsdt, payoutRate, INR_SCALE),
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
          // Exact strings, not recomputed floats — the same values the row stores.
          metadata: { amountUsdt: quote.amountUsdt, netInr: quote.netInr },
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
