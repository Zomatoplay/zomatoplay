"use server";

import { revalidate } from "@/server/revalidate";

import { decimal, MoneyError } from "@/db/money";
import { generateQrSvg } from "@/lib/qr";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { getWalletBalance } from "@/server/services/account.service";
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
  acknowledgeDeposit,
  listDepositActivityForUser,
  listUnacknowledgedDeposits,
  recordDepositIntent,
  type NewDepositConfirmation,
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
 * The only argument is `requestScan`, a boolean saying whether this tick is the
 * slow one that may walk the chain. The account still comes from the session,
 * the deposits still come back scoped to that account's id and its own assigned
 * deposit addresses, and the chain work still happens in the existing scanner
 * behind the existing TronGrid credentials. The browser cannot name a user, an
 * address, an amount or a transaction — and `requestScan: true` grants nothing
 * either, because `triggerDepositScan()` applies its own server-side floor and
 * single-flight regardless of who asked or how often.
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
  /**
   * Credited deposits this account has not acknowledged — what the
   * "USDT deposit confirmed" card renders.
   *
   * Returned on the *same* poll as the activity list rather than fetched by a
   * second component with a timer of its own: two pollers on one screen is two
   * round trips every five seconds for one question, and the deposit page is
   * the screen this codebase has already had to make cheaper once (§H7).
   */
  newDeposits: NewDepositView[];
  /** The balance as it stands now, so the confirmation can cite it. */
  availableUsdt: number | null;
}

export async function checkForDepositsAction(
  options: { requestScan?: boolean } = {},
): Promise<DepositCheckResult> {
  const { requestScan = false } = options;

  const account = await getAuthenticatedAccount();
  if (!account) {
    return {
      ok: false,
      message: "Not signed in.",
      scan: "skipped",
      deposits: [],
      newDeposits: [],
      availableUsdt: null,
    };
  }

  return traceAction(
    { name: "deposit.check", actorType: "user", pipeline: "deposit" },
    async () => {
      // The scan is global and idempotent, and it is the *only* thing that
      // reads the chain. A failure here is reported, never thrown: the state
      // already in the database is still worth showing.
      /*
       * THE CHEAP READ AND THE EXPENSIVE SCAN ARE NOT THE SAME CADENCE.
       *
       * Measured 2026-09-13 from `pipeline_events`: a pass that actually walks
       * the chain costs p50 **3,891 ms** — one solidified-block call (p50
       * 1,250 ms), one TRC-20 transfer query per watched address (~412 ms
       * each), a transaction-info call per candidate, and a cursor read and
       * write per address. The screen polls every 5 s. Left as one call, the
       * deposit page drove a chain scan roughly every 9 s, continuously, for
       * as long as it was open.
       *
       * That cadence buys nothing, and the chain says so: TRON solidifies
       * ~19 blocks behind — about **57 seconds** — and nothing is credited
       * before its block solidifies (§18.3). Scanning every 9 s to find
       * something that cannot be confirmed for a minute is TronGrid quota and
       * connection contention spent for no earlier answer.
       *
       * So `requestScan` is what the *caller* asks for, and the watcher asks
       * only on its slow tick. Every other tick skips the chain entirely and
       * does the one thing that makes the UI feel live: read this account's
       * deposits, which is a single indexed query. The background cron
       * (§18.5) remains the thing responsible for detection when nobody is
       * looking — this is still not the scheduler.
       */
      let scan: DepositCheckResult["scan"] = "skipped";
      let discovered = false;
      if (requestScan && isTronConfigured()) {
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
      /*
       * Two indexed reads in one wave, and a third only when it is needed.
       *
       * This runs every 5 s while the deposit screen is open, so its cost is
       * the screen's cost. The balance is only *rendered* by the confirmation
       * card, and there is usually no confirmation to show — so it is fetched
       * after, and only then. On the ordinary tick that is two parallel
       * queries (one round trip) rather than three.
       */
      const [deposits, newDeposits] = await Promise.all([
        listDepositActivityForUser(account.userId),
        listUnacknowledgedDeposits(account.userId),
      ]);
      const balance =
        newDeposits.length > 0 ? await getWalletBalance(account.userId) : null;

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
        newDeposits: newDeposits.map(toNewDepositView),
        availableUsdt: balance?.available ?? null,
      };
    },
  );
}

/** `a1b2c3…9f8e7d`. Enough to tell two transfers apart on a phone. */
function shortenTxHash(txHash: string): string {
  if (txHash.startsWith("intent:")) return "No chain transfer";
  return txHash.length > 16 ? `${txHash.slice(0, 6)}…${txHash.slice(-6)}` : txHash;
}


/* -------------------------------------------------------------------------- */
/* New-deposit confirmation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The "USDT deposit confirmed" state, and dismissing it.
 *
 * SERVER-AUTHORITATIVE, WHICH IS THE WHOLE REQUIREMENT
 * ----------------------------------------------------
 * "Is this deposit new to me" is answered by two columns on the deposit row —
 * `status = 'credited'` and `acknowledged_at is null` — not by anything the
 * browser remembers. The old screen listed recent deposits, so a deposit from
 * three weeks ago read as a fresh arrival on every visit; `localStorage` would
 * have fixed that for one browser and broken it again on the next device.
 *
 * The confirmation therefore corresponds to money that actually moved: a
 * transfer still waiting for its block to solidify has no confirmation, only
 * the status line the watcher already shows.
 */
export interface NewDepositView {
  id: string;
  amountUsdt: number;
  /** Shortened for display; the full hash is never needed in the browser. */
  txHashShort: string;
  txHash: string;
  networkLabel: string;
  tokenLabel: string;
  confirmationsCurrent: number;
  confirmationsRequired: number;
  /** ISO, formatted by the UTC-pinned formatters in `@/utils/format`. */
  creditedAt: string | null;
}

export interface NewDepositsResult {
  ok: boolean;
  message?: string;
  deposits: NewDepositView[];
  /** The balance as it stands now, so the card can show where the money went. */
  availableUsdt: number | null;
}

export async function getNewDepositsAction(): Promise<NewDepositsResult> {
  const account = await getAuthenticatedAccount();
  if (!account) {
    return { ok: false, message: "Not signed in.", deposits: [], availableUsdt: null };
  }

  try {
    /*
     * Both in one wave, and the balance costs nothing extra where this is
     * called from: `/wallet` already reads it through `getUserSlices`, and
     * `getWalletBalance` is request-memoised on the account id — so the two
     * calls resolve to one query (CLAUDE.md §16.2a).
     */
    const [deposits, balance] = await Promise.all([
      listUnacknowledgedDeposits(account.userId),
      getWalletBalance(account.userId),
    ]);

    return {
      ok: true,
      deposits: deposits.map(toNewDepositView),
      availableUsdt: balance?.available ?? null,
    };
  } catch {
    /*
     * A failed read here is a card that does not appear, never an error the
     * person has to act on: the money is credited either way and the wallet
     * shows it. Swallowed rather than surfaced for that reason — and the
     * failure is still recorded by the read's own instrumentation.
     */
    return { ok: true, deposits: [], availableUsdt: null };
  }
}

export interface AcknowledgeDepositResult {
  ok: boolean;
  message?: string;
}

/**
 * Dismisses one confirmation.
 *
 * The only thing the caller supplies is a deposit id, and the service's
 * `WHERE` clause checks that it belongs to this account, is credited, and is
 * not already acknowledged — so a forged id matches no row and changes
 * nothing. See `acknowledgeDeposit`.
 */
export async function acknowledgeDepositAction(input: {
  depositId: string;
}): Promise<AcknowledgeDepositResult> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email,
    role: "agent",
  };

  try {
    await acknowledgeDeposit(
      { depositId: input.depositId, userId: account.userId },
      actor,
    );
    // Idempotent by design: acknowledging something already acknowledged is a
    // no-op, so there is nothing for the caller to distinguish or retry.
    revalidate("/wallet/deposit", "/wallet");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not dismiss that.",
    };
  }
}

function toNewDepositView(deposit: NewDepositConfirmation): NewDepositView {
  return {
    id: deposit.id,
    amountUsdt: deposit.amountUsdt,
    txHash: deposit.txHash,
    txHashShort: shortenTxHash(deposit.txHash),
    networkLabel: `TRON ${TRON_NETWORK_LABELS[deposit.chainNetwork]}`,
    // The token the transfer was actually made in, as the chain reported it —
    // not a constant, because a row predating the pool may carry something
    // else and the card must not relabel it.
    tokenLabel: `${deposit.tokenSymbol ?? "USDT"} (${deposit.network.toUpperCase()})`,
    confirmationsCurrent: deposit.confirmationsCurrent,
    confirmationsRequired: deposit.confirmationsRequired,
    creditedAt: deposit.creditedAt ? deposit.creditedAt.toISOString() : null,
  };
}
