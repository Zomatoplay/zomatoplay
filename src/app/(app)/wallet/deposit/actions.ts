"use server";

import { after } from "next/server";

import { revalidate } from "@/server/revalidate";

import { generateQrSvg } from "@/lib/qr";
import { getUsableAccount } from "@/server/auth/account";
import { toSafeFailure } from "@/server/errors";
import { takeToken } from "@/server/rate-limit";
import { getWalletBalance } from "@/server/services/account.service";
import {
  cancelDepositRequest,
  createDepositRequest,
  getOwnDepositRequest,
  submitDepositTransactionHash,
  type DepositRequestView,
  type HashSubmissionOutcome,
} from "@/server/services/deposit-requests.service";
import {
  acknowledgeDeposit,
  listUnacknowledgedDeposits,
  type NewDepositConfirmation,
} from "@/server/services/deposits.service";
import { isTronConfigured, TRON_NETWORK_LABELS } from "@/server/tron/config";
import { triggerDepositScan } from "@/server/tron/scan-trigger";
import { traceAction } from "@/server/trace-action";
import type { Actor } from "@/server/write";
import { APP_NAME } from "@/constants/app";

/**
 * The deposit screen's server half: deposit requests and transaction hashes.
 *
 * WHAT THE BROWSER DECIDES: NOTHING THAT MOVES MONEY
 * --------------------------------------------------
 * The account always comes from the session (`getUsableAccount`). The
 * browser may send an amount it *wants* to deposit, a request id, and a hash.
 * It never sends — and no action here accepts — a user id, a receiving
 * address, a network, a verified amount or a status. The address is the
 * server's configured one; the verified amount and the credit come from the
 * chain, through the same matcher the scanner uses.
 */
export interface DepositActionResult {
  ok: boolean;
  message?: string;
  request?: DepositRequestView;
  /** The deposit address as a QR, rendered server-side. Bare address only. */
  qrSvg?: string;
}

function actorFor(account: { userId: string; fullName: string; email: string }): Actor {
  return {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email || account.userId,
    role: "agent",
  };
}

/**
 * Starts a deposit: a `DEP-XXXXXXXX` request with an exact amount to send.
 *
 * `amount` is what the person wants to deposit — a request, not a claim. The
 * exact amount to send is chosen by the server (see `createDepositRequest`).
 */
export async function createDepositRequestAction(input: {
  amount: string;
}): Promise<DepositActionResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!takeToken(`deposit-create:${account.userId}`, 10, 10 * 60 * 1000).allowed) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }

  return traceAction(
    { name: "deposit.request.create", actorType: "user", pipeline: "deposit" },
    async () => {
      try {
        const request = await createDepositRequest(
          { userId: account.userId, amount: String(input.amount ?? "") },
          actorFor(account),
        );
        // The QR carries the bare address and nothing else: TRON wallets
        // disagree about amount-bearing URIs, and a wallet that does not
        // understand one refuses to scan at all.
        const qrSvg = await generateQrSvg(request.receivingAddress);
        revalidate("/wallet/deposit");
        return { ok: true, request, qrSvg };
      } catch (error) {
        return {
          ok: false,
          message: toSafeFailure(error, "Could not start a deposit. Try again.").message,
        };
      }
    },
  );
}

/** The QR for an existing request, for a screen reopened on it. */
export async function getDepositRequestAction(input: {
  requestId: string;
}): Promise<DepositActionResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };
  const request = await getOwnDepositRequest(account.userId, String(input.requestId ?? ""));
  if (!request) return { ok: false, message: "That deposit request was not found." };
  return { ok: true, request, qrSvg: await generateQrSvg(request.receivingAddress) };
}

/**
 * Leaving the deposit screen: cancels the caller's request if — and only if —
 * nothing has been submitted or matched against it. The request id is the only
 * input and the service scopes it to the session's account in its `WHERE`.
 */
export async function cancelDepositRequestAction(input: {
  requestId: string;
}): Promise<DepositActionResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!takeToken(`deposit-cancel:${account.userId}`, 20, 10 * 60 * 1000).allowed) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }

  return traceAction(
    { name: "deposit.request.cancel", actorType: "user", pipeline: "deposit" },
    async () => {
      try {
        const result = await cancelDepositRequest(
          {
            userId: account.userId,
            requestId: String(input.requestId ?? ""),
            reason: "left_page",
          },
          actorFor(account),
        );
        revalidate("/wallet/deposit");
        if (result.outcome === "has_evidence") {
          return {
            ok: false,
            message:
              "A transaction was already submitted for this request, so it stays open until it is verified.",
            request: result.request ?? undefined,
          };
        }
        return { ok: true, request: result.request ?? undefined };
      } catch (error) {
        return {
          ok: false,
          message: toSafeFailure(error, "Could not cancel the deposit request.").message,
        };
      }
    },
  );
}

/** Customer-facing wording for each verification outcome. */
const OUTCOME_MESSAGES: Record<HashSubmissionOutcome, string> = {
  credited: "Payment verified on the blockchain and credited to your balance.",
  already_processed:
    "This deposit has already been processed. It was credited to your balance once and will not be credited again.",
  verifying:
    "Transaction found. It is waiting for final confirmation on the TRON network — usually about a minute. This screen will update.",
  needs_review:
    "Transaction found, but it does not match this request exactly (for example, a different amount). Our team will review it — no action is needed.",
  not_found:
    `We could not find a USDT (TRC-20) transfer with this hash to the ${APP_NAME} deposit address after this request was created. Check the hash, or try again in a minute if you have just sent it.`,
  already_used:
    "Transaction already processed. This transaction has already been used for a deposit and cannot be credited again.",
  not_yours: "This transaction does not match your deposit request.",
};

/** Per account: enough for genuine retries, not enough to probe the chain via us. */
const VERIFY_LIMIT = { attempts: 12, windowMs: 10 * 60 * 1000 };

export interface HashSubmissionActionResult extends DepositActionResult {
  outcome?: HashSubmissionOutcome;
}

/**
 * "Verify Payment". Idempotent and replay-safe: a transfer is credited once no
 * matter how many times, or by how many people, its hash is submitted.
 */
export async function submitDepositHashAction(input: {
  requestId: string;
  txHash: string;
}): Promise<HashSubmissionActionResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };

  const { allowed } = takeToken(
    `deposit-verify:${account.userId}`,
    VERIFY_LIMIT.attempts,
    VERIFY_LIMIT.windowMs,
  );
  if (!allowed) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }

  return traceAction(
    { name: "deposit.request.verify", actorType: "user", pipeline: "deposit" },
    async () => {
      try {
        const result = await submitDepositTransactionHash({
          userId: account.userId,
          requestId: String(input.requestId ?? ""),
          txHash: String(input.txHash ?? ""),
        });
        if (result.outcome === "credited" || result.outcome === "needs_review") {
          revalidate("/wallet/deposit", "/wallet", "/wallet/transactions", "/");
        }
        return {
          ok:
            result.outcome !== "not_found" &&
            result.outcome !== "already_used" &&
            result.outcome !== "not_yours",
          outcome: result.outcome,
          message: OUTCOME_MESSAGES[result.outcome],
          request: result.request,
        };
      } catch (error) {
        return {
          ok: false,
          message: toSafeFailure(error, "Could not verify the payment. Try again.").message,
        };
      }
    },
  );
}

/**
 * The deposit screen's poll, while a request is open.
 *
 * Two cadences, as before (§18.5): every tick re-reads the request and any
 * credited-but-unacknowledged deposits (cheap, indexed); the slow tick —
 * `requestScan` — additionally advances the chain: a request with a submitted
 * hash still waiting for finality re-checks that one transaction, and one
 * without a hash asks the scanner for a pass (single-flight, 4-second floor,
 * server-side regardless of who asks). Nothing the browser sends selects an
 * account, an address or an amount.
 */
export interface DepositCheckResult {
  ok: boolean;
  message?: string;
  request?: DepositRequestView;
  newDeposits: NewDepositView[];
  availableUsdt: number | null;
}

/** One chain lookup per account per this interval, whatever the client asks. */
const CHAIN_CHECK_FLOOR_MS = 20_000;

export async function checkDepositRequestAction(input: {
  requestId: string;
  requestScan?: boolean;
}): Promise<DepositCheckResult> {
  const account = await getUsableAccount();
  if (!account) {
    return { ok: false, message: "Your session has expired. Please sign in again.", newDeposits: [], availableUsdt: null };
  }

  return traceAction(
    { name: "deposit.check", actorType: "user", pipeline: "deposit" },
    async () => {
      const requestId = String(input.requestId ?? "");
      let request = await getOwnDepositRequest(account.userId, requestId);

      // The chain work is floored per account on the server: `requestScan` is
      // the client's cadence choice and grants nothing on its own.
      const chainAllowed =
        input.requestScan === true &&
        takeToken(`deposit-check-chain:${account.userId}`, 1, CHAIN_CHECK_FLOOR_MS).allowed;

      if (request && chainAllowed && isTronConfigured()) {
        try {
          if (request.status === "verifying" && request.submittedTxHash) {
            request = (
              await submitDepositTransactionHash({
                userId: account.userId,
                requestId,
                txHash: request.submittedTxHash,
              })
            ).request;
          } else if (request.status === "awaiting_payment") {
            /*
             * After the response, not before it. Next runs one client's
             * server actions one at a time, so awaiting a whole scanner pass
             * here made a "Verify Payment" press wait behind it — measured at
             * over 40 seconds. The pass is single-flight and floored
             * server-side; whatever it credits, the next tick reads.
             */
            after(async () => {
              try {
                await triggerDepositScan();
              } catch {
                // A failed pass is a delay; the scheduler and the next tick retry.
              }
            });
          }
        } catch {
          // A failed chain check is a delay, not an answer: the state already
          // recorded is still shown, and the next slow tick tries again.
        }
      }

      const newDeposits = await listUnacknowledgedDeposits(account.userId);
      const balance = newDeposits.length > 0 ? await getWalletBalance(account.userId) : null;
      if (newDeposits.length > 0) revalidate("/wallet", "/wallet/transactions", "/");

      return {
        ok: true,
        request: request ?? undefined,
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
  const account = await getUsableAccount();
  if (!account) {
    return { ok: false, message: "Your session has expired. Please sign in again.", deposits: [], availableUsdt: null };
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
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };

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
      message: toSafeFailure(error, "Could not dismiss that.").message,
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
