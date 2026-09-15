import "server-only";

import { desc, eq } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { Transaction } from "@/types";
import type { AdminDeposit, AdminWithdrawal } from "@/types/admin";

import { toAdminDeposit, toAdminWithdrawal, toTransaction } from "./mappers";

/**
 * The money ledger.
 *
 * `transactions` is the balance-affecting entry the user reads; `deposits` and
 * `withdrawals` are the rail records the CRM works. They are separate tables
 * for that reason, not by accident — see the schema.
 */

/**
 * One account's ledger, newest first.
 *
 * `limit` is optional and every caller should pass one. Home renders five
 * entries and Wallet six, and both used to read an account's **entire**
 * history to do it — fine at 200 rows, a growing per-render cost at 20,000,
 * and all of it serialised into the RSC payload on every navigation.
 *
 * Unbounded remains available because `/wallet/transactions` is the screen
 * that genuinely browses the history; it passes an explicit ceiling rather
 * than relying on the absence of one.
 */
export async function listTransactionsForUser(
  db: Database,
  userId: string,
  options: { limit?: number } = {},
): Promise<Transaction[]> {
  const query = db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.userId, userId))
    .orderBy(desc(schema.transactions.occurredAt));
  const rows = options.limit ? await query.limit(options.limit) : await query;
  return rows.map(toTransaction);
}

/**
 * Every deposit, attributed or not.
 *
 * A **left** join, and that is load-bearing: an unattributed deposit has no
 * user row to join to, and an inner join would quietly drop exactly the rows
 * an operator opens this screen to deal with.
 */
export async function listAdminDeposits(
  db: Database,
  options: { limit?: number } = {},
): Promise<AdminDeposit[]> {
  const query = db
    .select({ deposit: schema.deposits, user: schema.users })
    .from(schema.deposits)
    .leftJoin(schema.users, eq(schema.users.id, schema.deposits.userId))
    .orderBy(desc(schema.deposits.createdAt));
  const rows = options.limit ? await query.limit(options.limit) : await query;

  return rows.map(({ deposit, user }) =>
    toAdminDeposit(
      deposit,
      user ? { userName: user.fullName, userDisplayId: user.displayId } : null,
    ),
  );
}

/** One deposit by id, for the attribution flow. */
export async function findDepositById(db: Database, id: string) {
  const [row] = await db
    .select()
    .from(schema.deposits)
    .where(eq(schema.deposits.id, id))
    .limit(1);
  return row ?? null;
}

export async function listAdminWithdrawals(
  db: Database,
  options: { limit?: number } = {},
): Promise<AdminWithdrawal[]> {
  const base = db
    .select({ withdrawal: schema.withdrawals, user: schema.users })
    .from(schema.withdrawals)
    .innerJoin(schema.users, eq(schema.users.id, schema.withdrawals.userId))
    .orderBy(desc(schema.withdrawals.requestedAt));
  const rows = options.limit ? await base.limit(options.limit) : await base;

  return rows.map(({ withdrawal, user }) =>
    toAdminWithdrawal(withdrawal, {
      userName: user.fullName,
      userDisplayId: user.displayId,
    }),
  );
}
