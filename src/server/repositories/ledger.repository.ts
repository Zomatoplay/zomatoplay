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

export async function listTransactionsForUser(
  db: Database,
  userId: string,
): Promise<Transaction[]> {
  const rows = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.userId, userId))
    .orderBy(desc(schema.transactions.occurredAt));
  return rows.map(toTransaction);
}

/**
 * Every deposit, attributed or not.
 *
 * A **left** join, and that is load-bearing: an unattributed deposit has no
 * user row to join to, and an inner join would quietly drop exactly the rows
 * an operator opens this screen to deal with.
 */
export async function listAdminDeposits(db: Database): Promise<AdminDeposit[]> {
  const rows = await db
    .select({ deposit: schema.deposits, user: schema.users })
    .from(schema.deposits)
    .leftJoin(schema.users, eq(schema.users.id, schema.deposits.userId))
    .orderBy(desc(schema.deposits.createdAt));

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
): Promise<AdminWithdrawal[]> {
  const rows = await db
    .select({ withdrawal: schema.withdrawals, user: schema.users })
    .from(schema.withdrawals)
    .innerJoin(schema.users, eq(schema.users.id, schema.withdrawals.userId))
    .orderBy(desc(schema.withdrawals.requestedAt));

  return rows.map(({ withdrawal, user }) =>
    toAdminWithdrawal(withdrawal, {
      userName: user.fullName,
      userDisplayId: user.displayId,
    }),
  );
}
