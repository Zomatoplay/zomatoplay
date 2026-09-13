"use server";

import { revalidate } from "@/server/revalidate";

import { decimal, MoneyError } from "@/db/money";
import { generateQrSvg } from "@/lib/qr";
import { getAuthenticatedAccount } from "@/server/auth/account";
import {
  getTronConfig,
  isTronConfigured,
  TRON_NETWORK_LABELS,
  type TronNetwork,
} from "@/server/tron/config";
import {
  getOrCreateDepositAddress,
  DepositAddressServiceError,
} from "@/server/services/deposit-address.service";
import {
  listDepositActivityForUser,
  recordDepositIntent,
} from "@/server/services/deposits.service";
import { triggerDepositScan } from "@/server/tron/scan-trigger";
import { traceAction } from "@/server/trace-action";
import type { Actor } from "@/server/write";

/**
 * Resolving the caller's real TRC-20 USDT deposit address.
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
  /** Which TRON network this environment is actually pointed at. */
  network?: TronNetwork;
  networkLabel?: string;
  /**
   * Whether funds sent here are real.
   *
   * The screen shows a different warning for each, and getting it backwards is
   * the costliest thing this payload could do — so it is derived from the
   * configured network on the server rather than inferred in the browser.
   */
  isTestnet?: boolean;
  /**
   * The deposit address as a QR, rendered server-side.
   *
   * The payload is the bare address and nothing else — see below.
   */
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

  // Whatever this environment is configured for, mainnet included. The network
  // is never a parameter: a browser cannot ask for an address on a chain the
  // server is not scanning, which would be an address nothing could ever
  // credit.
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
        /*
         * The QR carries the address, and nothing else.
         *
         * A `tron:`-style URI with an amount or a token parameter is the
         * tempting alternative and is worse here: TRON wallets disagree about
         * whether they understand one, and a wallet that does not simply
         * refuses to scan — which reads to the person holding the phone as a
         * broken deposit screen. A bare base58 address is what every TRON
         * wallet accepts, and it is exactly the string `CopyField` shows
         * underneath, so the two can never disagree.
         */
        const qrSvg = await generateQrSvg(target.address);
        return {
          ok: true,
          address: target.address,
          network: config.network,
          networkLabel: TRON_NETWORK_LABELS[config.network],
          isTestnet: config.network !== "mainnet",
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

/**
 * The deposit screen's own check for new deposits.
 *
 * WHAT IT IS FOR
 * --------------
 * A person who has just sent test USDT should not have to press refresh, and
 * on this deployment they would have had to wait for the daily cron pass
 * (§18.5) or for somebody to type `npm run tron:scan`. While a deposit screen
 * is open, the screen asks for a pass itself, roughly every thirty seconds —
 * see `DepositWatcher`.
 *
 * **It is a testing/user-active-page mechanism and not the scheduler.** It runs
 * only while somebody is looking at the screen; a transfer that lands after the
 * tab is closed is still detected by `/api/cron/scan-deposits` and by nothing
 * else. See `triggerDepositScan` for the limits that make it safe to call from
 * a request, and CLAUDE.md §18.5 for why the real scheduler is a URL a cron
 * calls rather than a timer in the server process.
 *
 * WHAT THE BROWSER DECIDES: NOTHING
 * ---------------------------------
 * This action takes no arguments. The account comes from the session, the
 * deposits come back scoped to that account's id and its own assigned deposit
 * addresses, and the chain work happens in the existing scanner behind the
 * existing TronGrid credentials. The browser cannot name a user, an address, an
 * amount or a transaction — it can only ask "is there anything new for me".
 */
export interface DepositActivityItem {
  id: string;
  amountUsdt: number;
  status: (typeof import("@/db/schema").depositStatusEnum.enumValues)[number];
  /** Shortened for display; the full hash is never needed in the browser. */
  txHashShort: string;
}

export interface DepositCheckResult {
  ok: boolean;
  message?: string;
  /**
   * What the scan attempt actually did, so the screen never claims more than
   * happened. `skipped` means no pass was attempted at all — no session, or no
   * chain integration configured in this environment.
   */
  scan: "scanned" | "joined" | "throttled" | "failed" | "skipped";
  deposits: DepositActivityItem[];
}

export async function checkForDepositsAction(): Promise<DepositCheckResult> {
  const account = await getAuthenticatedAccount();
  if (!account) {
    return { ok: false, message: "Not signed in.", scan: "skipped", deposits: [] };
  }

  return traceAction(
    { name: "deposit.check", actorType: "user", pipeline: "deposit" },
    async () => {
      // The scan is global and idempotent, and it is the *only* thing that
      // reads the chain. A failure here is reported, never thrown: the state
      // already in the database is still worth showing.
      let scan: DepositCheckResult["scan"] = "skipped";
      let discovered = false;
      if (isTronConfigured()) {
        const result = await triggerDepositScan();
        scan = result.outcome;
        discovered =
          (result.summary?.created ?? 0) + (result.summary?.updated ?? 0) > 0;
      }

      /*
       * Deliberately no try/catch around this read.
       *
       * A failure is recorded by `traceAction` and surfaces to the screen,
       * which says it could not reach the server and tries again on the next
       * tick. Swallowing it would record nothing and make a database outage
       * look like an account with no deposits — the one thing a screen about
       * money must never do.
       */
      const deposits = await listDepositActivityForUser(account.userId);

      // Only when the chain actually moved: the wallet balance and the
      // transaction list live on other routes, and their cached copies are now
      // wrong. Revalidating on every poll would throw away a warm cache every
      // thirty seconds for nothing.
      if (discovered) revalidate("/wallet/deposit", "/wallet");

      return {
        ok: true,
        scan,
        deposits: deposits.map((deposit) => ({
          id: deposit.id,
          amountUsdt: deposit.amountUsdt,
          status: deposit.status,
          txHashShort: shortenTxHash(deposit.txHash),
        })),
      };
    },
  );
}

/** `a1b2c3…9f8e7d`. Enough to tell two transfers apart on a phone. */
function shortenTxHash(txHash: string): string {
  if (txHash.startsWith("intent:")) return "No chain transfer";
  return txHash.length > 16 ? `${txHash.slice(0, 6)}…${txHash.slice(-6)}` : txHash;
}
