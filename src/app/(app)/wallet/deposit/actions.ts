"use server";

import { revalidate } from "@/server/revalidate";

import { decimal, MoneyError } from "@/db/money";
import { generateQrSvg } from "@/lib/qr";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { getTronConfig, isTronConfigured } from "@/server/tron/config";
import {
  getOrCreateDepositAddress,
  DepositAddressServiceError,
} from "@/server/services/deposit-address.service";
import { recordDepositIntent } from "@/server/services/deposits.service";
import { traceAction } from "@/server/trace-action";
import type { Actor } from "@/server/write";

/**
 * Resolving the caller's real Shasta USDT deposit address.
 *
 * The only identity this trusts is the session: `getAuthenticatedAccount()`
 * resolves it server-side, and the resulting `userId` is what
 * `getOrCreateDepositAddress` allocates against. Nothing here accepts a
 * `userId`, a network or an asset from the client — the network is fixed to
 * whatever this environment is actually configured for, and the asset is
 * always USDT, because those are the only two things the pool understands
 * today. See `src/server/services/deposit-address.service.ts`.
 */
export interface DepositAddressResult {
  ok: boolean;
  message?: string;
  address?: string;
  networkLabel?: string;
  qrSvg?: string;
}

export async function getMyDepositAddressAction(): Promise<DepositAddressResult> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  if (!isTronConfigured()) {
    return {
      ok: false,
      message: "Deposits are not configured for this environment yet.",
    };
  }

  // `getTronConfig` itself refuses `TRON_NETWORK=mainnet` — see
  // `TronConfigError` in `@/server/tron/config` — so `config.network` is
  // always a testnet here. Nothing below issues a mainnet address because
  // there is no code path left that could.
  const config = getTronConfig();

  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email,
    role: "agent",
  };

  return traceAction(
    { name: "deposit.address.get", actorType: "user", pipeline: "deposit" },
    async () => {
      try {
        const target = await getOrCreateDepositAddress(
          account.userId,
          config.network,
          actor,
        );
        const qrSvg = await generateQrSvg(target.address);
        return {
          ok: true,
          address: target.address,
          networkLabel: config.network === "shasta" ? "Shasta testnet" : "Nile testnet",
          qrSvg,
        };
      } catch (error) {
        return {
          ok: false,
          message:
            error instanceof DepositAddressServiceError
              ? error.message
              : "Could not get a deposit address right now. Try again shortly.",
        };
      }
    },
  );
}

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
