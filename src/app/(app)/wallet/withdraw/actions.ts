"use server";

import { compare, decimal, isPositive, type Decimal } from "@/db/money";
import { getUsableAccount } from "@/server/auth/account";
import { trackPipeline } from "@/server/observability";
import { traceAction } from "@/server/trace-action";
import { revalidate } from "@/server/revalidate";
import { exactWithdrawalQuote } from "@/server/withdrawal-quote";
import { getPlatformFinanceFresh } from "@/server/services/catalogue.service";
import { requestWithdrawal } from "@/server/services/withdrawals-write.service";
import { checkWithdrawalPassword } from "@/server/services/withdrawal-password.service";
import { toSafeFailure } from "@/server/errors";
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
  /** The rate or fee changed since the screen loaded; nothing was requested. */
  quoteChanged?: boolean;
}

/** What the screen displayed. Used only to detect a change — never to price. */
interface ShownTerms {
  shownRate?: string;
  shownFlatFeeUsdt?: string;
  shownPercentFee?: string;
}

export async function requestWithdrawalAction(input: {
  amount: string;
  bankAccountId: string;
  /** Checked server-side against the stored hash; never logged or echoed. */
  withdrawalPassword: string;
} & ShownTerms): Promise<WithdrawResult> {
  return traceAction(
    { name: "withdrawal.request", actorType: "user", pipeline: "withdrawal" },
    () => runRequestWithdrawal(input),
  );
}

async function runRequestWithdrawal(input: {
  amount: string;
  bankAccountId: string;
  withdrawalPassword: string;
} & ShownTerms): Promise<WithdrawResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };

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

  /*
   * PRICED FROM THE ADMINISTRATOR'S SETTINGS, READ NOW.
   * The rate, the flat fee and the percentage are read fresh from the database
   * (`getPlatformFinanceFresh`), never from the request. If what the customer
   * was looking at no longer matches, the request is refused before anything is
   * held, so nobody confirms one figure and is charged another.
   */
  let finance;
  try {
    finance = await getPlatformFinanceFresh();
  } catch (error) {
    return { ok: false, message: toSafeFailure(error, "We couldn't complete this request. Your balance was not changed.").message };
  }
  const sameNumber = (shown: string | undefined, current: number) =>
    shown !== undefined && Number(shown) === current;
  if (
    !sameNumber(input.shownRate, finance.withdrawalRate) ||
    !sameNumber(input.shownFlatFeeUsdt, finance.flatFeeUsdt) ||
    !sameNumber(input.shownPercentFee, finance.percentFee)
  ) {
    return {
      ok: false,
      quoteChanged: true,
      message:
        "The withdrawal rate or fee was just updated. Please review the new figures and try again.",
    };
  }

  const minimum = decimal(finance.minimumWithdrawalUsdt);
  if (compare(amount, minimum) < 0) {
    return {
      ok: false,
      message: `The minimum withdrawal is ${finance.minimumWithdrawalUsdt} USDT.`,
    };
  }

  const priced = exactWithdrawalQuote(amount, finance);
  // A fee larger than the amount is a refusal, not a zero: clamping it would
  // have quoted a payout of ₹0 as if it were valid.
  if (!priced) {
    return { ok: false, message: "Fees exceed the amount requested." };
  }

  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email || account.displayId,
    role: "agent",
  };

  /*
   * THE WITHDRAWAL PASSWORD, BEFORE ANYTHING IS HELD.
   *
   * Checked in its own committed transaction (`checkWithdrawalPassword`), so a
   * wrong attempt is counted — and five lock withdrawals for 30 minutes — even
   * though the withdrawal it came with is refused. KYC, the freeze flags, the
   * destination and the balance are then checked by `requestWithdrawal`
   * inside the transaction that holds the funds, exactly as before.
   */
  try {
    await checkWithdrawalPassword(account.userId, input.withdrawalPassword, actor);
  } catch (error) {
    return { ok: false, message: toSafeFailure(error, "Your withdrawal password could not be checked. Try again.").message };
  }

  try {
    const quote = {
      amountUsdt: priced.amountUsdt,
      payoutRate: priced.payoutRate,
      flatFeeUsdt: priced.flatFeeUsdt,
      percentFeeUsdt: priced.percentFeeUsdt,
      totalFeeUsdt: priced.totalFeeUsdt,
      netInr: priced.netInr,
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
      message: toSafeFailure(error, "We couldn't complete this transaction. Your balance was not changed.").message,
    };
  }
}
