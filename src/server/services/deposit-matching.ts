import "server-only";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import type { Tx } from "@/db";

import {
  unmatchedDepositReasonLabels,
  type UnmatchedDepositReason,
} from "@/data/deposit-requests";

import { getTronConfig, isTronConfigured, type TronNetwork } from "../tron/config";
import { readActiveDepositAddress } from "./deposit-settings.service";

/**
 * Which deposit request — if any — a confirmed transfer belongs to.
 *
 * THE WHOLE ATTRIBUTION RULE
 * --------------------------
 * A transfer is attributed to a request only when ALL of these hold:
 *
 *   recipient   = the address the request was quoted          (the chain says)
 *   amount      = the request's exact expected amount          (the chain says)
 *   block time  ∈ [request created − 60s, request expires]     (the chain says)
 *   and exactly ONE request satisfies the three above.
 *
 * Every input is a chain fact. Who submitted the hash is not an input at all —
 * which is what defeats the front-running attack a shared address invites
 * (CLAUDE.md §18.4): a stranger who submits your transaction hash under their
 * own request cannot make your transfer match *their* amount, and the transfer
 * is credited to the request it does match, i.e. to you.
 *
 * The 60 seconds before creation absorb clock skew between this server and the
 * chain; the window's end is the request's own `expires_at`. Zero matches or
 * more than one is never guessed at: the deposit is left unattributed with a
 * named reason, for an operator (CLAUDE.md §18.4a).
 */

export const REQUEST_WINDOW_GRACE_MS = 60_000;

/**
 * Statuses a transfer may still satisfy. `credited`/`rejected` are closed.
 *
 * `cancelled` is matchable on purpose. A customer who paid and then left the
 * screen (which cancels the request) has still sent that exact amount, inside
 * that window, and no other request can hold the same figure until the window
 * closes — so the binding is exactly as strong as for an open request, and
 * the money reaches the person who sent it instead of an operator queue.
 */
export const MATCHABLE_REQUEST_STATUSES = [
  "awaiting_payment",
  "verifying",
  "expired",
  "needs_review",
  "cancelled",
] as const;

export type UnmatchedReason = UnmatchedDepositReason;

/** What an operator reads in the unmatched queue. */
export const UNMATCHED_REASON_LABELS = unmatchedDepositReasonLabels;

export type MatchResult =
  | { kind: "match"; request: { id: string; userId: string } }
  | { kind: "none"; reason: UnmatchedReason };

export async function findMatchingRequest(
  tx: Tx,
  transfer: {
    to: string;
    amount: Decimal;
    network: TronNetwork;
    blockTimestamp: Date | null;
  },
): Promise<MatchResult> {
  if (!transfer.blockTimestamp) return { kind: "none", reason: "no_block_time" };
  const at = transfer.blockTimestamp;
  const windowStartLimit = new Date(at.getTime() + REQUEST_WINDOW_GRACE_MS);

  // Locked, so the request cannot be credited by a concurrent path between this
  // read and the caller's update (which re-asserts the status anyway).
  const candidates = await tx
    .select({ id: t.depositRequests.id, userId: t.depositRequests.userId })
    .from(t.depositRequests)
    .where(
      and(
        eq(t.depositRequests.chain, "tron"),
        eq(t.depositRequests.chainNetwork, transfer.network),
        eq(t.depositRequests.receivingAddress, transfer.to),
        eq(t.depositRequests.expectedAmountUsdt, numericValue(transfer.amount)),
        inArray(t.depositRequests.status, [...MATCHABLE_REQUEST_STATUSES]),
        // created_at − grace ≤ block time  ⇔  created_at ≤ block time + grace
        lte(t.depositRequests.createdAt, windowStartLimit),
        gte(t.depositRequests.expiresAt, at),
      ),
    )
    .limit(2)
    .for("update");

  if (candidates.length === 1) return { kind: "match", request: candidates[0] };
  if (candidates.length > 1) return { kind: "none", reason: "ambiguous_match" };

  // No match — say why, so the operator starts from the right question.
  const [sameAmount] = await tx
    .select({ one: sql<number>`1` })
    .from(t.depositRequests)
    .where(
      and(
        eq(t.depositRequests.chainNetwork, transfer.network),
        eq(t.depositRequests.receivingAddress, transfer.to),
        eq(t.depositRequests.expectedAmountUsdt, numericValue(transfer.amount)),
      ),
    )
    .limit(1);
  if (sameAmount) return { kind: "none", reason: "outside_request_window" };

  const [quotedHere] = await tx
    .select({ one: sql<number>`1` })
    .from(t.depositRequests)
    .where(
      and(
        eq(t.depositRequests.chainNetwork, transfer.network),
        eq(t.depositRequests.receivingAddress, transfer.to),
      ),
    )
    .limit(1);
  if (quotedHere) return { kind: "none", reason: "no_matching_request" };

  if (isTronConfigured()) {
    const active = await readActiveDepositAddress(tx, getTronConfig());
    if (active?.address === transfer.to) {
      return { kind: "none", reason: "no_matching_request" };
    }
  }
  return { kind: "none", reason: "legacy_address" };
}
