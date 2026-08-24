import "server-only";

import { eq, sql } from "drizzle-orm";

import { decimalFrom, isPositive, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import type { Tx } from "@/db";
import type { TransactionStatus, TransactionType } from "@/types";

import { newId } from "../write";

/**
 * The only place a wallet balance changes.
 *
 * THE RULE
 * --------
 * A balance is never set; it is only ever moved, and every movement writes the
 * ledger row that explains it. `applyLedgerEntry` does both in one statement
 * pair inside the caller's transaction, so there is no code path that produces
 * a balance without its entry — which means the ledger always sums to the
 * balance, and a discrepancy is a bug rather than a mystery.
 *
 * ARITHMETIC HAPPENS IN POSTGRES
 * ------------------------------
 * `available = available + $1::numeric` — the database adds, using exact
 * decimal arithmetic. The application never reads a balance, adds to it in
 * JavaScript and writes it back. That would be wrong twice over: float64 drifts,
 * and a read-modify-write races another transaction doing the same thing. The
 * `UPDATE … SET x = x + n` form is atomic and exact.
 */

/** Which running total a movement affects, besides `available`. */
export type BalanceBucket =
  | "totalDeposited"
  | "totalInvested"
  | "totalWithdrawn"
  | "totalProfit"
  | "lockedInInvestments";

export interface LedgerEntry {
  userId: string;
  type: TransactionType;
  /** Signed: positive credits the wallet, negative debits it. */
  amount: Decimal;
  status?: TransactionStatus;
  description: string;
  reference?: string | null;
  network?: (typeof t.depositNetworkEnum.enumValues)[number] | null;
  confirmations?: { current: number; required: number } | null;
  inrAmount?: Decimal | null;
  feeUsdt?: Decimal | null;
  occurredAt: Date;
  /**
   * Running totals to move alongside `available`, each by its own amount.
   * Separate from the signed `amount` because they do not always agree: an
   * allocation debits `available` by 500 *and* raises `totalInvested` and
   * `lockedInInvestments` by 500.
   */
  buckets?: Partial<Record<BalanceBucket, Decimal>>;
  /**
   * When false the ledger row is written but no balance moves — a pending
   * withdrawal that has not been approved, say. Defaults to true.
   */
  affectsBalance?: boolean;
}

export class InsufficientFundsError extends Error {
  constructor(readonly userId: string) {
    super("The account does not have enough available balance.");
    this.name = "InsufficientFundsError";
  }
}

/**
 * Records a movement and applies it to the wallet.
 *
 * Returns the ledger row's id so the caller can link it — an investment
 * earning, for instance, points back at the entry that paid it.
 */
export async function applyLedgerEntry(
  tx: Tx,
  entry: LedgerEntry,
): Promise<string> {
  const id = newId("tx", entry.occurredAt);

  await tx.insert(t.transactions).values({
    id,
    userId: entry.userId,
    type: entry.type,
    amount: numericValue(entry.amount),
    currency: "USDT",
    status: entry.status ?? "completed",
    occurredAt: entry.occurredAt,
    description: entry.description,
    reference: entry.reference ?? null,
    network: entry.network ?? null,
    confirmationsCurrent: entry.confirmations?.current ?? null,
    confirmationsRequired: entry.confirmations?.required ?? null,
    inrAmount: entry.inrAmount ? numericValue(entry.inrAmount) : null,
    feeUsdt: entry.feeUsdt ? numericValue(entry.feeUsdt) : null,
  });

  if (entry.affectsBalance === false) {
    return id;
  }

  await moveBalance(tx, entry.userId, entry.amount, entry.buckets);
  return id;
}

/**
 * Applies the arithmetic, and refuses to overdraw.
 *
 * The guard is a `WHERE` clause rather than a read-then-check: a balance read
 * in JavaScript is already stale by the time the update runs, and two
 * concurrent withdrawals would both pass a check and both succeed. Postgres
 * evaluates `available + delta >= 0` against the row it is locking, so exactly
 * one of them wins.
 */
async function moveBalance(
  tx: Tx,
  userId: string,
  delta: Decimal,
  buckets: Partial<Record<BalanceBucket, Decimal>> = {},
): Promise<void> {
  const updates: Record<string, unknown> = {
    available: sql`${t.walletBalances.available} + ${delta}::numeric`,
    updatedAt: sql`now()`,
  };

  const columns: Record<BalanceBucket, typeof t.walletBalances.totalDeposited> = {
    totalDeposited: t.walletBalances.totalDeposited,
    totalInvested: t.walletBalances.totalInvested,
    totalWithdrawn: t.walletBalances.totalWithdrawn,
    totalProfit: t.walletBalances.totalProfit,
    lockedInInvestments: t.walletBalances.lockedInInvestments,
  };

  for (const [bucket, amount] of Object.entries(buckets)) {
    if (!amount) continue;
    const column = columns[bucket as BalanceBucket];
    updates[bucket] = sql`${column} + ${amount}::numeric`;
  }

  const debit = !isPositive(delta);

  const updated = await tx
    .update(t.walletBalances)
    .set(updates)
    .where(
      debit
        ? sql`${t.walletBalances.userId} = ${userId} and ${t.walletBalances.available} + ${delta}::numeric >= 0`
        : eq(t.walletBalances.userId, userId),
    )
    .returning({ userId: t.walletBalances.userId });

  if (updated.length === 0) {
    // Either the wallet is missing or the debit would overdraw it. Both are
    // refusals, and rolling the transaction back is the correct answer to both.
    throw new InsufficientFundsError(userId);
  }
}

/** Creates the wallet row a new account needs before it can hold anything. */
export async function ensureWallet(tx: Tx, userId: string): Promise<void> {
  await tx
    .insert(t.walletBalances)
    .values({ userId })
    .onConflictDoNothing({ target: t.walletBalances.userId });
}

/**
 * Reads a balance as exact decimals.
 *
 * Each column is cast to `text` in the query rather than read through its
 * `numeric`-as-number mapping. That mapping is right for display — the domain
 * types carry `number` — but it is a float, and a value that has already been
 * through one is not a sound basis for deciding whether a withdrawal fits.
 * Casting in SQL means the exact digits Postgres holds are the digits that
 * arrive.
 */
export async function readBalance(tx: Tx, userId: string) {
  const [row] = await tx
    .select({
      available: sql<string>`${t.walletBalances.available}::text`,
      totalDeposited: sql<string>`${t.walletBalances.totalDeposited}::text`,
      totalInvested: sql<string>`${t.walletBalances.totalInvested}::text`,
      totalWithdrawn: sql<string>`${t.walletBalances.totalWithdrawn}::text`,
      totalProfit: sql<string>`${t.walletBalances.totalProfit}::text`,
      lockedInInvestments: sql<string>`${t.walletBalances.lockedInInvestments}::text`,
    })
    .from(t.walletBalances)
    .where(eq(t.walletBalances.userId, userId))
    .limit(1);
  if (!row) return null;

  return {
    available: decimalFrom(row.available),
    totalDeposited: decimalFrom(row.totalDeposited),
    totalInvested: decimalFrom(row.totalInvested),
    totalWithdrawn: decimalFrom(row.totalWithdrawn),
    totalProfit: decimalFrom(row.totalProfit),
    lockedInInvestments: decimalFrom(row.lockedInInvestments),
  };
}
