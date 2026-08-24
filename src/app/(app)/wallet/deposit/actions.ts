"use server";

import { revalidate } from "@/server/revalidate";

import { decimal, MoneyError } from "@/db/money";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { recordDepositIntent } from "@/server/services/deposits.service";

/**
 * Development-only: records a *pending* deposit the operator can look at.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a deposit. It does not credit a wallet, it does not touch the
 * ledger, and it does not claim a blockchain transaction happened. It writes a
 * row with `status = 'pending'` and `verification = 'unverified'` so the rest
 * of the pipeline — operator review, the deposits queue — can be exercised
 * without waiting on a testnet transfer.
 *
 * The control that calls this replaced one that added money to the balance in
 * the browser. Only the scanner credits anything, and only from a solidified
 * on-chain transfer it verified itself.
 *
 * Refuses outside development. A production build has no path to this.
 */
export interface DepositIntentResult {
  ok: boolean;
  message: string;
}

export async function requestTestDeposit(input: {
  amount: string;
}): Promise<DepositIntentResult> {
  if (process.env.NODE_ENV === "production") {
    return {
      ok: false,
      message: "Test deposits are disabled outside development.",
    };
  }

  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  let amount;
  try {
    amount = decimal(input.amount);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof MoneyError ? error.message : "Invalid amount.",
    };
  }

  try {
    await recordDepositIntent({ userId: account.userId, amount });
    revalidate("/wallet/deposit", "/wallet");
    return {
      ok: true,
      message: "Pending deposit created. It stays pending until reviewed.",
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not record the request.",
    };
  }
}
