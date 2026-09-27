import "server-only";

import { randomBytes, randomInt } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { unstable_noStore as noStore } from "next/cache";

import { getDb, isDatabaseConfigured, type Tx } from "@/db";
import {
  add,
  compare,
  decimal,
  decimalFrom,
  MoneyError,
  numericValue,
  type Decimal,
} from "@/db/money";
import * as t from "@/db/schema";
import type { DepositRequestCancellationReason, DepositRequestStatus } from "@/types";

import { resilientRead } from "../database";
import { getTronConfig, isTronConfigured } from "../tron/config";
import { findTransferByHash, normalizeTxHash } from "../tron/verify-hash";
import { mutate, SYSTEM_ACTOR, type Actor } from "../write";
import { getDepositNetworks } from "./catalogue.service";
import { REQUEST_WINDOW_GRACE_MS } from "./deposit-matching";
import { readActiveDepositAddress } from "./deposit-settings.service";
import { recordObservedDeposit, type ClaimOutcome } from "./deposits.service";

/**
 * Deposit requests: the customer half of receiving USDT at ONE shared address.
 *
 *   Deposit ──▶ request (DEP-XXXXXXXX, exact amount, 60-minute window)
 *          ──▶ customer sends that exact amount to the configured address
 *          ──▶ customer submits the transaction hash   (optional, faster)
 *          ──▶ server finds the transfer ON THE CHAIN, checks finality
 *          ──▶ matcher: recipient + exact amount + window → exactly one request
 *          ──▶ credited, or "under review" for an operator
 *
 * The scanner runs the same matcher on every transfer it finds, so a customer
 * who never submits a hash is still credited — the hash is a way to be looked
 * up sooner, never the thing that decides whose money it is.
 *
 * THE EXACT AMOUNT IS THE BINDING
 * -------------------------------
 * `expected_amount_usdt` = what they asked to deposit + a random offset of
 * 0.01–0.99 USDT, unique among requests whose window is still open at this
 * address. Credited amount is whatever the chain shows — the offset is the
 * customer's own money and reaches their balance with the rest. A transfer
 * that differs by a cent (an exchange that deducted its fee from the amount,
 * say) matches nothing and goes to review: safe, never wrong.
 *
 * ONE REQUEST WAITING FOR PAYMENT PER CUSTOMER
 * --------------------------------------------
 * Changing the amount (or starting a new deposit) cancels the customer's
 * current `awaiting_payment` request in the same transaction that creates the
 * new one, and a partial unique index refuses a second. Cancelling is a status
 * change, never a delete, and it deliberately does NOT free the exact amount
 * early: a cancelled request's amount stays out of circulation until its window
 * closes, and a transfer of it inside that window is still matched to it. That
 * is what makes cancelling safe for somebody who had already paid — their
 * money still reaches them — and what stops a later request being quoted the
 * same figure and receiving it instead.
 */

export class DepositRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositRequestError";
  }
}

/** How long a request's exact amount stays reserved. */
export function depositRequestTtlMs(): number {
  const minutes = Number(process.env.DEPOSIT_REQUEST_TTL_MINUTES ?? "60");
  const clamped = Number.isFinite(minutes) ? Math.min(Math.max(minutes, 15), 24 * 60) : 60;
  return clamped * 60 * 1000;
}

/**
 * Open requests one account may hold at once — bounds amount-slot hoarding.
 * At most one of them is `awaiting_payment`; the rest are `verifying`, i.e.
 * a transaction was already submitted against them.
 */
const MAX_OPEN_REQUESTS_PER_USER = 3;
/** Largest single request. Well above any plan's maximum; bounds typos. */
const MAX_REQUEST_USDT = decimal("1000000");

export interface DepositRequestView {
  id: string;
  status: DepositRequestStatus;
  network: string;
  receivingAddress: string;
  requestedAmountUsdt: number;
  /** The exact amount to send — the one figure that matters. */
  expectedAmountUsdt: string;
  submittedTxHash: string | null;
  verifiedAmountUsdt: number | null;
  reviewReason: string | null;
  createdAt: string;
  expiresAt: string;
  verifiedAt: string | null;
}

const OPEN_STATUSES = ["awaiting_payment", "verifying"] as const;

/* -------------------------------------------------------------------------- */
/* Creation                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Creates a request, or returns the caller's identical open one.
 *
 * Serialised per receiving address by a transaction-scoped advisory lock, so
 * two requests cannot pick the same exact amount between the "which amounts
 * are taken" read and the insert. The partial unique index on open amounts is
 * the backstop a lock-free path could not get past either.
 */
export async function createDepositRequest(
  request: { userId: string; amount: string },
  actor: Actor,
): Promise<DepositRequestView> {
  if (!isTronConfigured()) {
    throw new DepositRequestError("Deposits are not available right now.");
  }
  const config = getTronConfig();

  let requested: Decimal;
  try {
    requested = decimal(request.amount);
  } catch (error) {
    if (error instanceof MoneyError) throw new DepositRequestError("Enter a valid amount.");
    throw error;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(requested)) {
    throw new DepositRequestError("Enter an amount with at most two decimal places.");
  }
  const minimum = await minimumDeposit();
  if (compare(requested, minimum) < 0) {
    throw new DepositRequestError(`The minimum deposit is ${minimum} USDT.`);
  }
  if (compare(requested, MAX_REQUEST_USDT) > 0) {
    throw new DepositRequestError("That amount is above the single-deposit limit.");
  }

  return mutate(actor, async ({ tx, now, audit }) => {
    const target = await readActiveDepositAddress(tx, config);
    if (!target) {
      throw new DepositRequestError("Deposits are not available right now.");
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`deposit-request:${config.network}:${target.address}`}))`,
    );

    // Lazily expire: an abandoned request stops reserving its amount without a
    // scheduler. Matching still honours its window (`findMatchingRequest`).
    await tx
      .update(t.depositRequests)
      .set({ status: "expired", updatedAt: now })
      .where(
        and(
          eq(t.depositRequests.status, "awaiting_payment"),
          lt(t.depositRequests.expiresAt, now),
        ),
      );

    const open = await tx
      .select()
      .from(t.depositRequests)
      .where(
        and(
          eq(t.depositRequests.userId, request.userId),
          inArray(t.depositRequests.status, [...OPEN_STATUSES]),
          gt(t.depositRequests.expiresAt, now),
        ),
      )
      .orderBy(desc(t.depositRequests.createdAt));

    // A double-tap, or reopening the screen: same address, same amount asked
    // for, still open — hand back the one they already have.
    const same = open.find(
      (row) =>
        row.status === "awaiting_payment" &&
        row.receivingAddress === target.address &&
        compare(decimalFrom(row.requestedAmountUsdt), requested) === 0,
    );
    if (same) return toView(same, now);

    // A different amount supersedes the request they were looking at. Only a
    // request with nothing submitted against it is cancelled; one with a
    // transaction hash is `verifying` and is left alone.
    const superseded = await cancelAwaitingRequests(tx, {
      userId: request.userId,
      now,
      reason: "amount_changed",
    });
    for (const cancelled of superseded) {
      audit({
        action: "user_updated",
        target: { type: "user", id: request.userId, label: request.userId },
        details:
          `Deposit request ${cancelled.id} (${formatExact(decimalFrom(cancelled.expectedAmountUsdt))} USDT) ` +
          `cancelled by the customer: amount changed to ${requested} USDT.`,
      });
    }
    const stillOpen = open.filter(
      (row) => !superseded.some((cancelled) => cancelled.id === row.id),
    );

    if (stillOpen.length >= MAX_OPEN_REQUESTS_PER_USER) {
      throw new DepositRequestError(
        "You already have open deposit requests. Complete one, or wait for it to expire.",
      );
    }

    // Every exact amount whose window is still open at this address.
    // As text: this set is compared exactly, and a float never enters it.
    const taken = await tx
      .select({ amount: sql<string>`${t.depositRequests.expectedAmountUsdt}::text` })
      .from(t.depositRequests)
      .where(
        and(
          eq(t.depositRequests.chainNetwork, config.network),
          eq(t.depositRequests.receivingAddress, target.address),
          gt(t.depositRequests.expiresAt, new Date(now.getTime() - REQUEST_WINDOW_GRACE_MS)),
        ),
      );
    const takenSet = new Set(taken.map((row) => decimalFrom(row.amount)));

    const expected = pickExpectedAmount(requested, takenSet);
    if (!expected) {
      throw new DepositRequestError(
        "Too many deposits of this amount are in progress. Try a slightly different amount.",
      );
    }

    const expiresAt = new Date(now.getTime() + depositRequestTtlMs());
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = newDepositRequestId();
      const inserted = await tx
        .insert(t.depositRequests)
        .values({
          id,
          userId: request.userId,
          chain: "tron",
          chainNetwork: config.network,
          asset: "usdt",
          receivingAddress: target.address,
          requestedAmountUsdt: numericValue(requested),
          expectedAmountUsdt: numericValue(expected),
          status: "awaiting_payment",
          createdAt: now,
          expiresAt,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: t.depositRequests.id })
        .returning();
      if (inserted.length > 0) return toView(inserted[0], now);
    }
    throw new DepositRequestError("Could not create a deposit request. Try again.");
  });
}

/**
 * `requested + 0.XX`, avoiding every amount in `taken`. Random, not
 * sequential, so the amount says nothing about how many deposits are open.
 * Exported for tests.
 */
export function pickExpectedAmount(requested: Decimal, taken: Set<string>): Decimal | null {
  const offsets = Array.from({ length: 99 }, (_, index) => index + 1);
  // Fisher–Yates with the CSPRNG.
  for (let i = offsets.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [offsets[i], offsets[j]] = [offsets[j], offsets[i]];
  }
  for (const cents of offsets) {
    const candidate = add(requested, decimal(`0.${String(cents).padStart(2, "0")}`));
    if (!taken.has(candidate)) return candidate;
  }
  return null;
}

/** `DEP-` + 8 characters of Crockford base32 — unmistakable for a 64-hex hash. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function newDepositRequestId(): string {
  const bytes = randomBytes(8);
  let out = "";
  for (const byte of bytes) out += ALPHABET[byte % 32];
  return `DEP-${out}`;
}

/**
 * Cancels the customer's request(s) waiting for payment with nothing submitted
 * against them. The guards are in the `WHERE`, so a request that was matched,
 * or had a hash submitted, a moment ago is not touched.
 */
async function cancelAwaitingRequests(
  tx: Tx,
  scope: {
    userId: string;
    now: Date;
    reason: DepositRequestCancellationReason;
    requestId?: string;
  },
) {
  return tx
    .update(t.depositRequests)
    .set({
      status: "cancelled",
      cancelledAt: scope.now,
      cancellationReason: scope.reason,
      updatedAt: scope.now,
    })
    .where(
      and(
        eq(t.depositRequests.userId, scope.userId),
        scope.requestId ? eq(t.depositRequests.id, scope.requestId) : undefined,
        eq(t.depositRequests.status, "awaiting_payment"),
        isNull(t.depositRequests.submittedTxHash),
        isNull(t.depositRequests.depositId),
      ),
    )
    .returning();
}

export type CancelDepositRequestOutcome =
  /** It was waiting for payment and is now cancelled. */
  | "cancelled"
  /** Already cancelled or expired — nothing to do. */
  | "already_closed"
  /** A transaction was submitted or matched: evidence exists, so it stays. */
  | "has_evidence";

/**
 * The customer leaving the deposit screen: "cancel my request".
 *
 * Only ever moves `awaiting_payment` → `cancelled`. A request with a submitted
 * hash, a matched deposit, a review, or a credit is refused — those are
 * evidence, and leaving a screen must not be able to change them. Scoped to
 * the caller's own rows in the `WHERE` itself.
 */
export async function cancelDepositRequest(
  request: { userId: string; requestId: string; reason: DepositRequestCancellationReason },
  actor: Actor,
): Promise<{ outcome: CancelDepositRequestOutcome; request: DepositRequestView | null }> {
  const existing = await readOwnRequest(request.userId, request.requestId);
  if (!existing) throw new DepositRequestError("That deposit request was not found.");

  return mutate(actor, async ({ tx, now, audit }) => {
    const [cancelled] = await cancelAwaitingRequests(tx, {
      userId: request.userId,
      requestId: existing.id,
      now,
      reason: request.reason,
    });
    if (cancelled) {
      audit({
        action: "user_updated",
        target: { type: "user", id: request.userId, label: request.userId },
        details:
          `Deposit request ${cancelled.id} (${formatExact(decimalFrom(cancelled.expectedAmountUsdt))} USDT) ` +
          `cancelled by the customer (${request.reason === "left_page" ? "left the deposit screen" : "amount changed"}).`,
      });
      return { outcome: "cancelled", request: toView(cancelled, now) };
    }

    const [current] = await tx
      .select()
      .from(t.depositRequests)
      .where(
        and(
          eq(t.depositRequests.id, existing.id),
          eq(t.depositRequests.userId, request.userId),
        ),
      )
      .limit(1);
    if (!current) throw new DepositRequestError("That deposit request was not found.");
    const closed = current.status === "cancelled" || current.status === "expired" ||
      (current.status === "awaiting_payment" && current.expiresAt.getTime() < now.getTime());
    return {
      outcome: closed ? "already_closed" : "has_evidence",
      request: toView(current, now),
    };
  });
}

async function minimumDeposit(): Promise<Decimal> {
  const networks = await getDepositNetworks();
  const trc20 = networks.find((network) => network.id === "trc20");
  return trc20 ? decimalFrom(trc20.minDeposit) : decimal("10");
}

/* -------------------------------------------------------------------------- */
/* Hash submission                                                             */
/* -------------------------------------------------------------------------- */

export type HashSubmissionOutcome =
  /** Credited by THIS submission (or by the scanner a moment before it). */
  | "credited"
  /** This request was already credited with this very transaction. */
  | "already_processed"
  | "verifying"
  | "needs_review"
  | "not_found"
  | "already_used"
  | "not_yours";

export interface HashSubmissionResult {
  outcome: HashSubmissionOutcome;
  request: DepositRequestView;
}

/**
 * A customer's "I paid — here is the transaction hash".
 *
 * `userId` is the caller's own, from the session; `requestId` must belong to
 * them; the hash is only a search key. Everything that decides money — does the
 * transfer exist, on which network, in which token, to which address, for how
 * much, is it final, whose request does it match — is read from the chain and
 * decided by `recordObservedDeposit`. Replaying this is harmless: the unique
 * index on (chain, tx_hash) and on `deposit_requests.deposit_id` mean a
 * transfer is credited once however many times, or by however many people, it
 * is submitted.
 */
export async function submitDepositTransactionHash(request: {
  userId: string;
  requestId: string;
  txHash: string;
}): Promise<HashSubmissionResult> {
  if (!isTronConfigured()) {
    throw new DepositRequestError("Deposits are not available right now.");
  }
  const config = getTronConfig();

  const txHash = normalizeTxHash(request.txHash);
  if (!txHash) {
    throw new DepositRequestError(
      "That does not look like a TRON transaction hash (64 letters and numbers).",
    );
  }

  const row = await readOwnRequest(request.userId, request.requestId);
  if (!row) throw new DepositRequestError("That deposit request was not found.");

  if (row.status === "rejected") {
    throw new DepositRequestError("This deposit request is closed. Create a new one.");
  }

  // Already known to the ledger? Decide from the record before asking the chain.
  const [known] = await getDb()
    .select({ id: t.deposits.id, status: t.deposits.status })
    .from(t.deposits)
    .where(and(eq(t.deposits.chain, "tron"), eq(t.deposits.txHash, txHash)))
    .limit(1);
  if (known?.status === "credited") {
    return {
      outcome: row.depositId === known.id ? "already_processed" : "already_used",
      request: toView(row, new Date()),
    };
  }
  // Credited through a different transaction: this request is finished, and
  // a second hash cannot be attached to it.
  if (row.status === "credited") {
    return { outcome: "already_used", request: toView(row, new Date()) };
  }

  const lookup = await findTransferByHash(config, {
    txHash,
    recipient: row.receivingAddress,
    // The listing is time-ordered; anything before the request cannot match it.
    sinceMs: row.createdAt.getTime() - REQUEST_WINDOW_GRACE_MS,
  });

  if (lookup.status === "not_found") {
    return { outcome: "not_found", request: toView(row, new Date()) };
  }

  if (!lookup.confirmed) {
    // Real, but not final yet. Remember the claim so the screen can re-check;
    // nothing is recorded as a deposit until the block solidifies (§18.3).
    const updated = await mutate(SYSTEM_ACTOR, async ({ tx, now }) => {
      const [changed] = await tx
        .update(t.depositRequests)
        .set({ status: "verifying", submittedTxHash: txHash, submittedAt: now, updatedAt: now })
        .where(
          and(
            eq(t.depositRequests.id, row.id),
            eq(t.depositRequests.userId, request.userId),
            inArray(t.depositRequests.status, [
              "awaiting_payment",
              "verifying",
              "expired",
              "cancelled",
            ]),
          ),
        )
        .returning();
      return changed ?? row;
    });
    return { outcome: "verifying", request: toView(updated, new Date()) };
  }

  const { transfer } = lookup;
  const recorded = await recordObservedDeposit(
    {
      txHash: transfer.txHash,
      from: transfer.from,
      to: transfer.to,
      contract: transfer.contract,
      tokenSymbol: transfer.tokenSymbol,
      amount: transfer.amount,
      blockNumber: lookup.blockNumber,
      blockTimestamp: transfer.blockTimestamp,
      network: config.network,
      confirmed: true,
      confirmationsRequired: config.requireConfirmation ? 1 : 0,
    },
    SYSTEM_ACTOR,
    { requestId: row.id, userId: request.userId },
  );

  const after = (await readOwnRequest(request.userId, row.id)) ?? row;
  return {
    outcome: claimToOutcome(recorded.claim),
    request: toView(after, new Date()),
  };
}

function claimToOutcome(claim: ClaimOutcome | undefined): HashSubmissionOutcome {
  if (claim === "credited") return "credited";
  if (claim === "needs_review") return "needs_review";
  return "not_yours";
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

async function readOwnRequest(userId: string, requestId: string) {
  if (!/^DEP-[0-9A-Z]{8}$/.test(requestId)) return null;
  const [row] = await resilientRead(() =>
    getDb()
      .select()
      .from(t.depositRequests)
      .where(
        and(eq(t.depositRequests.id, requestId), eq(t.depositRequests.userId, userId)),
      )
      .limit(1),
  );
  return row ?? null;
}

/** One of the caller's own requests. Scoped by owner in the query itself. */
export async function getOwnDepositRequest(
  userId: string,
  requestId: string,
): Promise<DepositRequestView | null> {
  if (!isDatabaseConfigured()) return null;
  noStore();
  const row = await readOwnRequest(userId, requestId);
  return row ? toView(row, new Date()) : null;
}

/** The caller's most recent requests, newest first. */
export async function listOwnDepositRequests(
  userId: string,
  limit = 5,
): Promise<DepositRequestView[]> {
  if (!isDatabaseConfigured()) return [];
  noStore();
  const now = new Date();
  const rows = await resilientRead(() =>
    getDb()
      .select()
      .from(t.depositRequests)
      .where(eq(t.depositRequests.userId, userId))
      .orderBy(desc(t.depositRequests.createdAt))
      .limit(limit),
  );
  return rows.map((row) => toView(row, now));
}

function toView(row: typeof t.depositRequests.$inferSelect, now: Date): DepositRequestView {
  // `expired` is written lazily; a passed window reads as expired immediately.
  const status: DepositRequestStatus =
    row.status === "awaiting_payment" && row.expiresAt.getTime() < now.getTime()
      ? "expired"
      : row.status;
  const expected = decimalFrom(row.expectedAmountUsdt);
  return {
    id: row.id,
    status,
    network: row.chainNetwork,
    receivingAddress: row.receivingAddress,
    requestedAmountUsdt: row.requestedAmountUsdt,
    // Two decimal places, exactly: this is the figure a person types into a
    // wallet, and it must match to the cent.
    expectedAmountUsdt: formatExact(expected),
    submittedTxHash: row.submittedTxHash,
    verifiedAmountUsdt: row.verifiedAmountUsdt,
    reviewReason: row.reviewReason,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  };
}

/** `100.5` → `100.50`. Expected amounts never carry more than two places. */
function formatExact(amount: Decimal): string {
  const [whole, fraction = ""] = amount.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}
