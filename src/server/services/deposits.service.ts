import "server-only";

import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";

import { decimalFrom, isPositive, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import type { Tx } from "@/db";

import { applyLedgerEntry, ensureWallet } from "../repositories/wallet.repository";
import { fromDatabase } from "../database";
import { mutate, newId, withReason, SYSTEM_ACTOR, type Actor } from "../write";

/**
 * Deposits: recording what the chain shows, and attributing it to an account.
 *
 * Two separate concerns, kept separate on purpose:
 *
 * - **Recording** is mechanical and automatic. The scanner sees a transfer and
 *   writes a row. It never guesses whose money it is.
 * - **Attribution** is a decision, made by an operator, and audited. See the
 *   note on the `deposits` table for why it cannot be automatic with a single
 *   receiving address.
 *
 * Crediting only happens after both, and only once.
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

export interface RecordResult {
  outcome: RecordOutcome;
  depositId: string;
}

/**
 * Records an observed transfer, or updates the row that already represents it.
 *
 * IDEMPOTENCY
 * -----------
 * `onConflictDoNothing` against the unique index on (chain, tx_hash) is what
 * makes a re-scan harmless. It is a database constraint rather than a prior
 * `SELECT … WHERE tx_hash = ?` because two scanners — or one scanner and its
 * own retry — can pass that check simultaneously and both insert. The index
 * cannot be raced.
 *
 * A transfer seen again while still unconfirmed gets its confirmation state
 * refreshed; one that is already credited is never touched again.
 */
export async function recordObservedDeposit(
  transfer: ObservedTransfer,
  actor: Actor = SYSTEM_ACTOR,
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

    if (inserted.length > 0) {
      audit({
        action: "deposit_credited",
        target: {
          type: "deposit",
          id: inserted[0].id,
          label: `${transfer.amount} USDT from ${transfer.from}`,
        },
        details:
          `Detected ${transfer.amount} USDT on TRON ${transfer.network} ` +
          `(${transfer.txHash}). Unassigned pending operator attribution.`,
      });
      return { outcome: "created" as const, depositId: inserted[0].id };
    }

    // Already known. Refresh confirmation state, but never re-open a deposit
    // that has already moved money.
    const [existing] = await tx
      .select({ id: t.deposits.id, status: t.deposits.status })
      .from(t.deposits)
      .where(and(eq(t.deposits.chain, "tron"), eq(t.deposits.txHash, transfer.txHash)))
      .limit(1);

    if (!existing) return { outcome: "unchanged" as const, depositId: id };

    if (existing.status === "credited" || existing.status === "ignored") {
      return { outcome: "unchanged" as const, depositId: existing.id };
    }

    if (transfer.confirmed && existing.status !== "confirmed") {
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
      return { outcome: "updated" as const, depositId: existing.id };
    }

    return { outcome: "unchanged" as const, depositId: existing.id };
  });
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

    audit({
      action: "deposit_credited",
      target: {
        type: "deposit",
        id: deposit.id,
        label: `${amount} USDT · ${deposit.txHash}`,
      },
      details: withReason(
        `Assigned to ${user.name} (${user.displayId}) and credited ${amount} USDT. ` +
          `Ledger entry ${ledgerTxId}.`,
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
      chainNetwork: "shasta",
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
