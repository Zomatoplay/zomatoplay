import "server-only";

import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { unstable_noStore as noStore } from "next/cache";

import { decimalFrom, isPositive, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import { getDb, isDatabaseConfigured, type Tx } from "@/db";

import {
  findMatchingRequest,
  MATCHABLE_REQUEST_STATUSES,
  UNMATCHED_REASON_LABELS,
  type UnmatchedReason,
} from "./deposit-matching";
import { getTronConfig, isTronConfigured } from "../tron/config";
import { applyLedgerEntry, ensureWallet } from "../repositories/wallet.repository";
import { fromDatabase, resilientRead } from "../database";
import { mutate, newId, withReason, SYSTEM_ACTOR, type Actor } from "../write";

/**
 * Deposits: recording what the chain shows, and attributing it to an account.
 *
 * Two separate concerns, kept separate on purpose:
 *
 * - **Recording** is mechanical and automatic. The scanner — or a customer's
 *   submitted hash, looked up on the chain — sees a transfer and writes a row.
 * - **Attribution** is a lookup, not a guess: the transfer's recipient, exact
 *   amount and block time are matched against open deposit requests
 *   (`findMatchingRequest`). Exactly one match is credited automatically, in
 *   the same transaction as the recording. Anything else is recorded
 *   unattributed with a named `unmatched_reason`, and `assignDepositToUser`
 *   below is how an operator resolves it by hand.
 *
 * Crediting only ever happens once, whichever path resolves it: both are
 * guarded by the unique index on (chain, tx_hash), the unique index on
 * `deposit_requests.deposit_id`, and the same re-asserted `WHERE status = …`
 * pattern used everywhere else money moves in this codebase.
 */

export interface ObservedTransfer {
  txHash: string;
  from: string;
  to: string;
  contract: string;
  tokenSymbol: string | null;
  amount: Decimal;
  blockNumber: bigint | null;
  blockTimestamp: Date | null;
  network: "shasta" | "nile" | "mainnet";
  confirmed: boolean;
  confirmationsRequired: number;
}

export type RecordOutcome = "created" | "updated" | "unchanged";

/**
 * What happened to a customer's claim on this transfer, when there was one.
 *
 *   credited      matched THEIR request and is in their wallet (now or before)
 *   needs_review  on-chain and valid, but not matchable — an operator decides
 *   not_yours     attributed to a different request; their claim changes nothing
 */
export type ClaimOutcome = "credited" | "needs_review" | "not_yours";

export interface RecordResult {
  outcome: RecordOutcome;
  depositId: string;
  claim?: ClaimOutcome;
}

/** A customer saying "this transfer is for my request". Never decides ownership. */
export interface DepositClaim {
  requestId: string;
  userId: string;
}

/**
 * Records an observed transfer, or updates the row that already represents it.
 *
 * IDEMPOTENCY
 * -----------
 * `onConflictDoNothing` against the unique index on (chain, tx_hash) is what
 * makes a re-scan harmless. It is a database constraint rather than a prior
 * `SELECT … WHERE tx_hash = ?` because two scanners — or one scanner and a
 * customer's Verify Payment, or one of them and its own retry — can pass that
 * check simultaneously and both insert. The index cannot be raced.
 *
 * A transfer seen again while still unconfirmed gets its confirmation state
 * refreshed; one that is already credited is never touched again.
 *
 * AUTOMATIC ATTRIBUTION
 * ----------------------
 * Once a deposit is `confirmed` and has no `userId`, it is matched against
 * deposit requests (`findMatchingRequest`). One match is credited through the
 * exact ledger path an operator's manual assignment uses (`ensureWallet` +
 * `applyLedgerEntry`) — this is not a second way for money to move.
 *
 * THE CLAIM
 * ---------
 * `claim` is present when a customer submitted this hash. It is processed
 * AFTER attribution and cannot influence it: it only records, on the
 * claimant's own request, what attribution decided.
 */
export async function recordObservedDeposit(
  transfer: ObservedTransfer,
  actor: Actor = SYSTEM_ACTOR,
  claim?: DepositClaim,
): Promise<RecordResult> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const id = newId("dep", now);
    const status = transfer.confirmed ? "confirmed" : "confirming";

    const inserted = await tx
      .insert(t.deposits)
      .values({
        id,
        userId: null,
        amountUsdt: numericValue(transfer.amount),
        chain: "tron",
        chainNetwork: transfer.network,
        network: "trc20",
        tokenContract: transfer.contract,
        tokenSymbol: transfer.tokenSymbol,
        senderAddress: transfer.from,
        walletAddress: transfer.to,
        txHash: transfer.txHash,
        blockNumber: transfer.blockNumber,
        blockTimestamp: transfer.blockTimestamp,
        status,
        verification: "verified",
        detectedAt: now,
        confirmedAt: transfer.confirmed ? now : null,
        confirmationsCurrent: transfer.confirmed
          ? transfer.confirmationsRequired
          : 0,
        confirmationsRequired: transfer.confirmationsRequired,
        createdAt: transfer.blockTimestamp ?? now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: [t.deposits.chain, t.deposits.txHash] })
      .returning({ id: t.deposits.id });

    let depositId: string;
    let outcome: RecordOutcome;
    let eligibleForAutoCredit = false;

    if (inserted.length > 0) {
      depositId = inserted[0].id;
      outcome = "created";
      eligibleForAutoCredit = transfer.confirmed;
      audit({
        action: "deposit_credited",
        target: {
          type: "deposit",
          id: depositId,
          label: `${transfer.amount} USDT from ${transfer.from}`,
        },
        details:
          `Detected ${transfer.amount} USDT on TRON ${transfer.network} ` +
          `(${transfer.txHash}).`,
      });
    } else {
      // Already known. Refresh confirmation state, but never re-open a deposit
      // that has already moved money.
      const [existing] = await tx
        .select({ id: t.deposits.id, status: t.deposits.status, userId: t.deposits.userId })
        .from(t.deposits)
        .where(and(eq(t.deposits.chain, "tron"), eq(t.deposits.txHash, transfer.txHash)))
        .limit(1)
        .for("update");

      if (!existing) return { outcome: "unchanged" as const, depositId: id };
      depositId = existing.id;
      outcome = "unchanged";

      if (
        transfer.confirmed &&
        existing.status !== "confirmed" &&
        existing.status !== "credited" &&
        existing.status !== "ignored" &&
        existing.status !== "failed"
      ) {
        await tx
          .update(t.deposits)
          .set({
            status: "confirmed",
            confirmedAt: now,
            confirmationsCurrent: transfer.confirmationsRequired,
            blockNumber: transfer.blockNumber,
            blockTimestamp: transfer.blockTimestamp,
            updatedAt: now,
          })
          .where(eq(t.deposits.id, existing.id));
        outcome = "updated";
        eligibleForAutoCredit = existing.userId === null;
      }
    }

    if (eligibleForAutoCredit) {
      await attributeConfirmedDeposit(tx, now, audit, depositId, transfer);
    }

    const claimOutcome = claim
      ? await applyClaim(tx, now, depositId, transfer.txHash, claim)
      : undefined;

    return { outcome, depositId, claim: claimOutcome };
  });
}

type WriteTx = Tx;
type AuditFn = Parameters<Parameters<typeof mutate>[1]>[0]["audit"];

/**
 * Matches a newly confirmed, unattributed deposit to a request and credits
 * it — or records why it could not be matched.
 */
async function attributeConfirmedDeposit(
  tx: WriteTx,
  now: Date,
  audit: AuditFn,
  depositId: string,
  transfer: ObservedTransfer,
): Promise<void> {
  const match = await findMatchingRequest(tx, {
    to: transfer.to,
    amount: transfer.amount,
    network: transfer.network,
    blockTimestamp: transfer.blockTimestamp,
  });

  if (match.kind === "none") {
    await tx
      .update(t.deposits)
      .set({ unmatchedReason: match.reason, updatedAt: now })
      .where(and(eq(t.deposits.id, depositId), isNull(t.deposits.userId)));
    return;
  }

  const [user] = await tx
    .select({ id: t.users.id, name: t.users.fullName, displayId: t.users.displayId })
    .from(t.users)
    .where(eq(t.users.id, match.request.userId))
    .limit(1);
  // The request's account no longer resolves — leave it for an operator rather
  // than crediting nobody's wallet.
  if (!user) {
    await tx
      .update(t.deposits)
      .set({ unmatchedReason: "no_matching_request", updatedAt: now })
      .where(eq(t.deposits.id, depositId));
    return;
  }

  await ensureWallet(tx, user.id);
  const ledgerTxId = await applyLedgerEntry(tx, {
    userId: user.id,
    type: "deposit",
    amount: transfer.amount,
    description: "Deposit received",
    reference: transfer.txHash,
    network: "trc20",
    confirmations: {
      current: transfer.confirmationsRequired,
      required: transfer.confirmationsRequired,
    },
    occurredAt: now,
    buckets: { totalDeposited: transfer.amount },
  });

  const credited = await tx
    .update(t.deposits)
    .set({
      userId: user.id,
      assignedAt: now,
      assignedBy: "deposit-request",
      status: "credited",
      creditedAt: now,
      unmatchedReason: null,
      updatedAt: now,
    })
    // Re-asserted so a deposit an operator credited manually between this
    // transaction starting and reaching here is refused, not double-paid.
    .where(and(eq(t.deposits.id, depositId), eq(t.deposits.status, "confirmed")))
    .returning({ id: t.deposits.id });
  if (credited.length === 0) {
    throw new DepositError("That deposit was credited by someone else just now.");
  }

  const closed = await tx
    .update(t.depositRequests)
    .set({
      status: "credited",
      depositId,
      verifiedAmountUsdt: numericValue(transfer.amount),
      verifiedAt: now,
      reviewReason: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(t.depositRequests.id, match.request.id),
        inArray(t.depositRequests.status, [...MATCHABLE_REQUEST_STATUSES]),
      ),
    )
    .returning({ id: t.depositRequests.id });
  // The request was closed concurrently; the whole credit rolls back with this.
  if (closed.length === 0) {
    throw new DepositError("That deposit request changed while it was being credited.");
  }

  audit({
    action: "deposit_credited",
    target: {
      type: "deposit",
      id: depositId,
      label: `${transfer.amount} USDT · ${transfer.txHash}`,
    },
    details:
      `Matched to deposit request ${match.request.id} for ${user.name} (${user.displayId}) ` +
      `by exact amount, recipient and time window, and credited ${transfer.amount} USDT. ` +
      `Ledger entry ${ledgerTxId}.`,
  });
}

/**
 * Records, on the claimant's OWN request, what attribution decided about the
 * transfer they submitted. Changes nothing about the deposit or any balance.
 */
async function applyClaim(
  tx: WriteTx,
  now: Date,
  depositId: string,
  txHash: string,
  claim: DepositClaim,
): Promise<ClaimOutcome> {
  const [deposit] = await tx
    .select({
      status: t.deposits.status,
      userId: t.deposits.userId,
      unmatchedReason: t.deposits.unmatchedReason,
    })
    .from(t.deposits)
    .where(eq(t.deposits.id, depositId))
    .limit(1);
  const [request] = await tx
    .select({ id: t.depositRequests.id, depositId: t.depositRequests.depositId })
    .from(t.depositRequests)
    .where(
      and(
        eq(t.depositRequests.id, claim.requestId),
        eq(t.depositRequests.userId, claim.userId),
      ),
    )
    .limit(1)
    .for("update");

  if (!deposit || !request) return "not_yours";
  if (request.depositId === depositId) return "credited";
  // Somebody else's matched transfer, or credited by an operator to another
  // account: the claimant's request is left exactly as it was.
  if (deposit.status === "credited" || deposit.userId !== null) return "not_yours";

  const reason = deposit.unmatchedReason as UnmatchedReason | null;
  await tx
    .update(t.depositRequests)
    .set({
      status: "needs_review",
      submittedTxHash: txHash,
      submittedAt: now,
      reviewReason: reason
        ? UNMATCHED_REASON_LABELS[reason]
        : "The transfer could not be matched automatically.",
      updatedAt: now,
    })
    .where(
      and(
        eq(t.depositRequests.id, request.id),
        inArray(t.depositRequests.status, [...MATCHABLE_REQUEST_STATUSES]),
      ),
    );
  return "needs_review";
}

/**
 * Attributes a deposit to an account and credits it, in one transaction.
 *
 * The guards are all in the `WHERE` clause rather than in prior reads, so two
 * operators clicking assign at the same moment cannot both succeed: the second
 * update matches no row.
 */
export async function assignDepositToUser(
  request: { depositId: string; userId: string; note?: string },
  actor: Actor,
): Promise<{ credited: boolean; amount: Decimal }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const deposit = await lockDeposit(tx, request.depositId);

    if (!deposit) {
      throw new DepositError(`No deposit ${request.depositId}.`);
    }
    if (deposit.status === "credited") {
      throw new DepositError("That deposit has already been credited.");
    }
    if (deposit.status === "ignored") {
      throw new DepositError("That deposit was ignored. Reopen it first.");
    }
    if (deposit.status !== "confirmed") {
      throw new DepositError(
        `That deposit is ${deposit.status}, not confirmed. Crediting an ` +
          `unconfirmed transfer risks crediting money a re-org takes back.`,
      );
    }

    const [user] = await tx
      .select({ id: t.users.id, name: t.users.fullName, displayId: t.users.displayId })
      .from(t.users)
      .where(eq(t.users.id, request.userId))
      .limit(1);
    if (!user) throw new DepositError(`No user ${request.userId}.`);

    const amount = decimalFrom(deposit.amountUsdt);

    await ensureWallet(tx, user.id);

    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: user.id,
      type: "deposit",
      amount,
      description: "Deposit received",
      reference: deposit.txHash,
      network: "trc20",
      confirmations: {
        current: deposit.confirmationsCurrent,
        required: deposit.confirmationsRequired,
      },
      occurredAt: now,
      buckets: { totalDeposited: amount },
    });

    const updated = await tx
      .update(t.deposits)
      .set({
        userId: user.id,
        assignedAt: now,
        assignedBy: actor.name,
        status: "credited",
        creditedAt: now,
        unmatchedReason: null,
        updatedAt: now,
      })
      // Re-asserting the status here is what makes the whole thing safe under
      // concurrency: if another transaction credited it first, this matches
      // nothing and the ledger entry above rolls back with it.
      .where(and(eq(t.deposits.id, deposit.id), eq(t.deposits.status, "confirmed")))
      .returning({ id: t.deposits.id });

    if (updated.length === 0) {
      throw new DepositError("That deposit was credited by someone else just now.");
    }

    /*
     * Close the loop on the customer side. The account's own request that
     * claimed this hash (if any) becomes `credited` and is bound to the
     * deposit; every other account's claim on the same hash is `rejected`, so
     * nobody is left looking at "under review" for money that went elsewhere.
     */
    const claims = await tx
      .select({ id: t.depositRequests.id, userId: t.depositRequests.userId })
      .from(t.depositRequests)
      .where(
        and(
          eq(t.depositRequests.submittedTxHash, deposit.txHash),
          inArray(t.depositRequests.status, [...MATCHABLE_REQUEST_STATUSES]),
        ),
      )
      .for("update");
    const own = claims.find((claim) => claim.userId === user.id);
    if (own) {
      await tx
        .update(t.depositRequests)
        .set({
          status: "credited",
          depositId: deposit.id,
          verifiedAmountUsdt: numericValue(amount),
          verifiedAt: now,
          reviewReason: null,
          updatedAt: now,
        })
        .where(eq(t.depositRequests.id, own.id));
    }
    const others = claims.filter((claim) => claim.userId !== user.id).map((claim) => claim.id);
    if (others.length > 0) {
      await tx
        .update(t.depositRequests)
        .set({
          status: "rejected",
          reviewReason: "Reviewed: this transaction was attributed to a different account.",
          updatedAt: now,
        })
        .where(inArray(t.depositRequests.id, others));
    }

    audit({
      action: "deposit_credited",
      target: {
        type: "deposit",
        id: deposit.id,
        label: `${amount} USDT · ${deposit.txHash}`,
      },
      details: withReason(
        `Assigned to ${user.name} (${user.displayId}) and credited ${amount} USDT. ` +
          `Ledger entry ${ledgerTxId}.` +
          (own ? ` Satisfies their deposit request ${own.id}.` : "") +
          (others.length > 0 ? ` Closed ${others.length} other claim(s) on this hash.` : ""),
        request.note,
      ),
    });

    return { credited: true, amount };
  });
}

/**
 * Records a pending, unverified deposit that no chain transfer backs.
 *
 * Development only, and the row says so: `pending` / `unverified`, with no
 * transaction hash the explorer would resolve and no ledger entry. It exists so
 * the operator queue can be exercised without a testnet transfer, and it is
 * deliberately incapable of becoming money — `assignDepositToUser` refuses
 * anything that is not `confirmed`, and only the scanner sets that.
 */
export async function recordDepositIntent(
  request: { userId: string; amount: Decimal },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ depositId: string }> {
  if (!isPositive(request.amount)) {
    throw new DepositError("A deposit amount must be greater than zero.");
  }

  return mutate(actor, async ({ tx, now, audit }) => {
    const depositId = newId("dep", now);

    await tx.insert(t.deposits).values({
      id: depositId,
      // Attributed, because the signed-in user asked for it — unlike a chain
      // transfer, whose payer is unknown.
      userId: request.userId,
      amountUsdt: numericValue(request.amount),
      chain: "tron",
      // Whatever this environment is pointed at, so a dev fixture in a mainnet
      // deployment does not show an operator a `shasta` row that never existed
      // on any chain. It still describes no transfer either way.
      chainNetwork: isTronConfigured() ? getTronConfig().network : "shasta",
      network: "trc20",
      walletAddress: "(not a chain transfer)",
      // Prefixed so it can never be mistaken for a transaction hash, and never
      // collides with the unique index the scanner relies on.
      txHash: `intent:${depositId}`,
      status: "pending",
      verification: "unverified",
      confirmationsRequired: 0,
      detectedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    audit({
      action: "deposit_credited",
      target: { type: "deposit", id: depositId, label: `${request.amount} USDT` },
      details:
        `Development test deposit recorded as pending. No chain transfer backs ` +
        `it and no funds were credited.`,
    });

    return { depositId };
  });
}

/**
 * Closes a deposit as failed.
 *
 * Distinct from `ignoreDeposit`, and the difference is who the reason is for.
 * "Ignored" means *this was not a platform deposit* — somebody else's transfer,
 * a token we do not accept — and is internal bookkeeping. "Failed" means *your
 * deposit did not go through*, and the reason is shown to the account it was
 * attributed to. Both refuse a credited deposit, because reversing money that
 * has been made available is a ledger entry, not a status change.
 */
export async function failDeposit(
  request: { depositId: string; reason: string },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const deposit = await lockDeposit(tx, request.depositId);
    if (!deposit) throw new DepositError(`No deposit ${request.depositId}.`);
    if (deposit.status === "credited") {
      throw new DepositError(
        "That deposit has been credited. Reversing it is a ledger adjustment, " +
          "not a status change.",
      );
    }

    const updated = await tx
      .update(t.deposits)
      .set({ status: "failed", failureReason: request.reason, updatedAt: now })
      .where(and(eq(t.deposits.id, deposit.id), ne(t.deposits.status, "credited")))
      .returning({ id: t.deposits.id });

    if (updated.length === 0) {
      throw new DepositError("That deposit changed while you were deciding.");
    }

    audit({
      action: "deposit_failed",
      target: { type: "deposit", id: deposit.id, label: deposit.txHash },
      details: withReason("Closed as failed. No funds were credited.", request.reason),
    });
  });
}

/**
 * Credits a deposit that is already attributed to an account.
 *
 * The queue's other path: `assignDepositToUser` both attributes and credits an
 * unattributed transfer, while this one credits a transfer whose owner is
 * already known. Same guards, same ledger entry, same re-asserted status in the
 * `WHERE` so two operators cannot both succeed.
 */
export async function creditAttributedDeposit(
  request: { depositId: string; note?: string },
  actor: Actor,
): Promise<{ amount: Decimal }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const deposit = await lockDeposit(tx, request.depositId);
    if (!deposit) throw new DepositError(`No deposit ${request.depositId}.`);
    if (!deposit.userId) {
      throw new DepositError(
        "That deposit is not attributed to an account. Assign it first — a " +
          "transfer to the shared address does not say who sent it.",
      );
    }
    if (deposit.status === "credited") {
      throw new DepositError("That deposit has already been credited.");
    }
    if (deposit.status !== "confirmed") {
      throw new DepositError(
        `That deposit is ${deposit.status}, not confirmed. Crediting an ` +
          `unconfirmed transfer risks crediting money a re-org takes back.`,
      );
    }

    const amount = decimalFrom(deposit.amountUsdt);
    await ensureWallet(tx, deposit.userId);

    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: deposit.userId,
      type: "deposit",
      amount,
      description: "Deposit received",
      reference: deposit.txHash,
      network: "trc20",
      confirmations: {
        current: deposit.confirmationsCurrent,
        required: deposit.confirmationsRequired,
      },
      occurredAt: now,
      buckets: { totalDeposited: amount },
    });

    const updated = await tx
      .update(t.deposits)
      .set({ status: "credited", creditedAt: now, updatedAt: now })
      .where(and(eq(t.deposits.id, deposit.id), eq(t.deposits.status, "confirmed")))
      .returning({ id: t.deposits.id });

    if (updated.length === 0) {
      throw new DepositError("That deposit was credited by someone else just now.");
    }

    audit({
      action: "deposit_credited",
      target: {
        type: "deposit",
        id: deposit.id,
        label: `${amount} USDT · ${deposit.txHash}`,
      },
      details: withReason(
        `Credited ${amount} USDT. Ledger entry ${ledgerTxId}.`,
        request.note,
      ),
    });

    return { amount };
  });
}

/** Marks a transfer as not a platform deposit. Reversible, and audited. */
export async function ignoreDeposit(
  request: { depositId: string; reason: string },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const deposit = await lockDeposit(tx, request.depositId);
    if (!deposit) throw new DepositError(`No deposit ${request.depositId}.`);
    if (deposit.status === "credited") {
      throw new DepositError("A credited deposit cannot be ignored.");
    }

    await tx
      .update(t.deposits)
      .set({
        status: "ignored",
        failureReason: request.reason,
        updatedAt: now,
      })
      .where(eq(t.deposits.id, deposit.id));

    audit({
      action: "deposit_failed",
      target: { type: "deposit", id: deposit.id, label: deposit.txHash },
      details: withReason("Marked as not a platform deposit.", request.reason),
    });
  });
}

/** Returns an ignored deposit to the queue. */
export async function reopenDeposit(
  request: { depositId: string; note?: string },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const deposit = await lockDeposit(tx, request.depositId);
    if (!deposit) throw new DepositError(`No deposit ${request.depositId}.`);
    if (deposit.status !== "ignored") {
      throw new DepositError("Only an ignored deposit can be reopened.");
    }

    await tx
      .update(t.deposits)
      .set({
        status: deposit.confirmedAt ? "confirmed" : "confirming",
        failureReason: null,
        updatedAt: now,
      })
      .where(eq(t.deposits.id, deposit.id));

    audit({
      action: "deposit_credited",
      target: { type: "deposit", id: deposit.id, label: deposit.txHash },
      details: withReason("Returned to the deposit queue.", request.note),
    });
  });
}

export class DepositError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositError";
  }
}

/**
 * Selects a deposit `FOR UPDATE`.
 *
 * The row lock serialises two operators acting on the same deposit. Without it
 * both would read `confirmed`, both would build a ledger entry, and only the
 * `WHERE status = 'confirmed'` guard downstream would stop the second — after
 * it had already done the work.
 */
async function lockDeposit(tx: Tx, depositId: string) {
  const [row] = await tx
    .select()
    .from(t.deposits)
    .where(eq(t.deposits.id, depositId))
    .limit(1)
    .for("update");
  return row ?? null;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/** Deposits waiting for an operator to attribute them. */
export async function getUnassignedDepositCount(): Promise<number> {
  return fromDatabase(
    async (db) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(t.deposits)
        .where(and(isNull(t.deposits.userId), eq(t.deposits.status, "confirmed")));
      return row?.count ?? 0;
    },
    () => 0,
  );
}

/** The most recent chain deposits, for the user's own deposit screen. */
export async function getRecentChainDeposits(limit = 5) {
  return fromDatabase(
    async (db) =>
      db
        .select({
          id: t.deposits.id,
          amountUsdt: t.deposits.amountUsdt,
          txHash: t.deposits.txHash,
          status: t.deposits.status,
          senderAddress: t.deposits.senderAddress,
          detectedAt: t.deposits.detectedAt,
          confirmedAt: t.deposits.confirmedAt,
        })
        .from(t.deposits)
        .orderBy(desc(t.deposits.createdAt))
        .limit(limit),
    () => [],
  );
}

/**
 * What the signed-in account should see on its own deposit screen.
 *
 * SCOPED BY IDENTITY, NEVER BY RESEMBLANCE
 * ----------------------------------------
 * Only deposits attributed to this account — credited through its own deposit
 * request, or assigned to it by an operator. A transfer still waiting for its
 * block to solidify is shown on the deposit screen through the *request*
 * (`deposit_requests`), not here: with one shared address, an unattributed
 * transfer belongs to nobody yet, and showing it to whoever is looking would
 * be exactly the guess §18.4 refuses.
 */
export interface UserDepositActivity {
  id: string;
  amountUsdt: number;
  status: (typeof t.depositStatusEnum.enumValues)[number];
  txHash: string;
  detectedAt: Date | null;
  /** Null while the deposit is still unattributed. */
  userId: string | null;
}

export async function listDepositActivityForUser(
  userId: string,
  limit = 5,
): Promise<UserDepositActivity[]> {
  if (!isDatabaseConfigured()) {
    throw new DepositError(
      "No DATABASE_URL is configured, so there is no deposit state to read.",
    );
  }
  noStore();

  return resilientRead(async () => {
    const db = getDb();
    return db
      .select({
        id: t.deposits.id,
        amountUsdt: t.deposits.amountUsdt,
        status: t.deposits.status,
        txHash: t.deposits.txHash,
        detectedAt: t.deposits.detectedAt,
        userId: t.deposits.userId,
      })
      .from(t.deposits)
      .where(eq(t.deposits.userId, userId))
      .orderBy(desc(t.deposits.createdAt))
      .limit(limit);
  });
}

/* -------------------------------------------------------------------------- */
/* New-deposit confirmation                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A credited deposit this account has not been shown a confirmation for.
 *
 * WHAT "NEW" MEANS HERE, AND WHY IT IS A DATABASE FACT
 * -----------------------------------------------------
 * `status = 'credited' and acknowledged_at is null`. Both halves matter:
 *
 * - **credited** — the money is actually in the wallet. The confirmation is
 *   never shown for a transfer that was merely *detected*, or is waiting for
 *   its block to solidify, because a screen that says "25 USDT has been added
 *   to your wallet" while the balance has not moved is worse than no screen.
 *   The deposit watcher already shows in-flight transfers with their status.
 * - **not acknowledged** — the person has not dismissed it. Kept in the
 *   database rather than in `localStorage`, which would re-announce a
 *   three-week-old deposit on every new device and every cleared cache; the
 *   column comment on `deposits.acknowledged_at` has the full reasoning.
 *
 * The browser decides nothing about either. It cannot mark a deposit credited,
 * and `acknowledgeDeposit` below will only touch a row that already is.
 */
export interface NewDepositConfirmation {
  id: string;
  amountUsdt: number;
  txHash: string;
  /** `tron`, and the specific network the transfer arrived on. */
  chain: (typeof t.chainEnum.enumValues)[number];
  chainNetwork: (typeof t.chainNetworkEnum.enumValues)[number];
  tokenSymbol: string | null;
  network: (typeof t.depositNetworkEnum.enumValues)[number];
  confirmationsCurrent: number;
  confirmationsRequired: number;
  creditedAt: Date | null;
  blockTimestamp: Date | null;
}

export async function listUnacknowledgedDeposits(
  userId: string,
  limit = 3,
): Promise<NewDepositConfirmation[]> {
  if (!isDatabaseConfigured()) {
    throw new DepositError(
      "No DATABASE_URL is configured, so there is no deposit state to read.",
    );
  }
  noStore();

  return resilientRead(async () =>
    getDb()
      .select({
        id: t.deposits.id,
        amountUsdt: t.deposits.amountUsdt,
        txHash: t.deposits.txHash,
        chain: t.deposits.chain,
        chainNetwork: t.deposits.chainNetwork,
        tokenSymbol: t.deposits.tokenSymbol,
        network: t.deposits.network,
        confirmationsCurrent: t.deposits.confirmationsCurrent,
        confirmationsRequired: t.deposits.confirmationsRequired,
        creditedAt: t.deposits.creditedAt,
        blockTimestamp: t.deposits.blockTimestamp,
      })
      .from(t.deposits)
      .where(
        and(
          // Scoped to the caller's own id, which the caller never supplies —
          // the action resolves it from the session.
          eq(t.deposits.userId, userId),
          eq(t.deposits.status, "credited"),
          isNull(t.deposits.acknowledgedAt),
        ),
      )
      // Newest first: several arriving at once is possible, and the most
      // recent is the one somebody is standing in front of the screen for.
      .orderBy(desc(t.deposits.creditedAt))
      .limit(limit),
  );
}

/**
 * Marks a credited deposit as seen by the account that owns it.
 *
 * WHAT MAKES THIS SAFE TO CALL FROM A BROWSER
 * -------------------------------------------
 * Three things, all in the `WHERE` clause rather than in a prior read:
 *
 * - `user_id = $caller` — ownership, so an id guessed or copied from somebody
 *   else's screen matches no row. The caller's id comes from the session, not
 *   from the request.
 * - `status = 'credited'` — this can only ever act on a deposit that already
 *   moved money. It cannot create, credit, advance or reopen anything.
 * - `acknowledged_at is null` — one-way. Acknowledging twice is a no-op, so a
 *   double-tap, a retry and two open tabs all produce the same single result.
 *
 * It writes no ledger entry and no audit entry, deliberately: this changes
 * nothing about money or authority. It records that a person closed a card.
 */
export async function acknowledgeDeposit(
  request: { depositId: string; userId: string },
  actor: Actor,
): Promise<{ acknowledged: boolean }> {
  return mutate(actor, async ({ tx, now }) => {
    const updated = await tx
      .update(t.deposits)
      .set({ acknowledgedAt: now, updatedAt: now })
      .where(
        and(
          eq(t.deposits.id, request.depositId),
          eq(t.deposits.userId, request.userId),
          eq(t.deposits.status, "credited"),
          isNull(t.deposits.acknowledgedAt),
        ),
      )
      .returning({ id: t.deposits.id });

    return { acknowledged: updated.length > 0 };
  });
}
