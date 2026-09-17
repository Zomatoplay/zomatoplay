import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { Transaction } from "@/types";
import type {
  AdminDeposit,
  AdminDepositsSummary,
  AdminListQuery,
  AdminWithdrawal,
  AdminWithdrawalsSummary,
  PagedResult,
} from "@/types/admin";

import { likePattern, pageTotal, readPage } from "./paginate";
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

/* -------------------------------------------------------------------------- */
/* The paginated money queues                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What the deposit screen's search box matches.
 *
 * A transaction hash and a receiving address are the two things an operator is
 * most often handed — by a customer who has paid and is asking where it went —
 * so both are searchable alongside the payer's own identifiers.
 */
function depositSearchCondition(search: string) {
  if (!search) return undefined;
  const pattern = likePattern(search);
  return or(
    ilike(schema.deposits.txHash, pattern),
    ilike(schema.deposits.walletAddress, pattern),
    ilike(schema.deposits.id, pattern),
    ilike(schema.users.fullName, pattern),
    ilike(schema.users.email, pattern),
    ilike(schema.users.displayId, pattern),
  );
}

const DEPOSIT_SORTS = {
  recent: () => desc(schema.deposits.createdAt),
  oldest: () => asc(schema.deposits.createdAt),
  amount: () => desc(schema.deposits.amountUsdt),
} as const;

/** One page of the deposit ledger. The left join is still load-bearing. */
export async function pageAdminDeposits(
  db: Database,
  query: AdminListQuery,
): Promise<PagedResult<AdminDeposit>> {
  const where = and(
    query.status === "all"
      ? undefined
      : eq(
          schema.deposits.status,
          query.status as (typeof schema.deposits.status.enumValues)[number],
        ),
    depositSearchCondition(query.search),
  );

  return readPage(query, async (page) => {
    const rows = await db
      .select({
        deposit: schema.deposits,
        user: schema.users,
        total: pageTotal,
      })
      .from(schema.deposits)
      .leftJoin(schema.users, eq(schema.users.id, schema.deposits.userId))
      .where(where)
      .orderBy(DEPOSIT_SORTS[query.sort as keyof typeof DEPOSIT_SORTS]())
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);

    return {
      rows: rows.map(({ deposit, user }) =>
        toAdminDeposit(
          deposit,
          user
            ? { userName: user.fullName, userDisplayId: user.displayId }
            : null,
        ),
      ),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

export async function countAdminDepositsByStatus(
  db: Database,
  query: AdminListQuery,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: schema.deposits.status, count: sql<number>`count(*)::int` })
    .from(schema.deposits)
    .leftJoin(schema.users, eq(schema.users.id, schema.deposits.userId))
    .where(depositSearchCondition(query.search))
    .groupBy(schema.deposits.status);

  return tallyByStatus(rows);
}

function withdrawalSearchCondition(search: string) {
  if (!search) return undefined;
  const pattern = likePattern(search);
  return or(
    ilike(schema.withdrawals.id, pattern),
    ilike(schema.users.fullName, pattern),
    ilike(schema.users.email, pattern),
    ilike(schema.users.displayId, pattern),
  );
}

const WITHDRAWAL_SORTS = {
  recent: () => desc(schema.withdrawals.requestedAt),
  oldest: () => asc(schema.withdrawals.requestedAt),
  amount: () => desc(schema.withdrawals.amountUsdt),
} as const;

/** One page of the payout queue. Inner join: a withdrawal always has an owner. */
export async function pageAdminWithdrawals(
  db: Database,
  query: AdminListQuery,
): Promise<PagedResult<AdminWithdrawal>> {
  const where = and(
    query.status === "all"
      ? undefined
      : eq(
          schema.withdrawals.status,
          query.status as (typeof schema.withdrawals.status.enumValues)[number],
        ),
    withdrawalSearchCondition(query.search),
  );

  return readPage(query, async (page) => {
    const rows = await db
      .select({
        withdrawal: schema.withdrawals,
        user: schema.users,
        total: pageTotal,
      })
      .from(schema.withdrawals)
      .innerJoin(schema.users, eq(schema.users.id, schema.withdrawals.userId))
      .where(where)
      .orderBy(WITHDRAWAL_SORTS[query.sort as keyof typeof WITHDRAWAL_SORTS]())
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);

    return {
      rows: rows.map(({ withdrawal, user }) =>
        toAdminWithdrawal(withdrawal, {
          userName: user.fullName,
          userDisplayId: user.displayId,
        }),
      ),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

export async function countAdminWithdrawalsByStatus(
  db: Database,
  query: AdminListQuery,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: schema.withdrawals.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.withdrawals)
    .innerJoin(schema.users, eq(schema.users.id, schema.withdrawals.userId))
    .where(withdrawalSearchCondition(query.search))
    .groupBy(schema.withdrawals.status);

  return tallyByStatus(rows);
}

/** `[{status, count}]` → `{status: count, all: total}`, for the chips. */
function tallyByStatus(
  rows: { status: string; count: number }[],
): Record<string, number> {
  const counts: Record<string, number> = { all: 0 };
  for (const row of rows) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/* The stat cards above the queues                                             */
/* -------------------------------------------------------------------------- */

/**
 * The deposit screen's three figures, in one statement.
 *
 * Platform-wide and deliberately unfiltered, which is what the browser used to
 * compute over the whole `deposits` array. The money is summed as `float8`
 * because these are **display aggregates only** — no balance is derived from
 * them, and nothing here is written back. Every figure that moves money goes
 * through `@/db/money` and exact `numeric` arithmetic (CLAUDE.md §17.2).
 */
export async function readDepositsSummary(
  db: Database,
): Promise<AdminDepositsSummary> {
  const rows = await db.execute<{
    credited_usdt: number;
    in_flight_count: number;
    in_flight_usdt: number;
  }>(sql`
    select
      coalesce(sum(${schema.deposits.amountUsdt})
        filter (where ${schema.deposits.status} = 'credited'), 0)::float8
        as credited_usdt,
      count(*) filter (where ${schema.deposits.status} not in ('credited', 'failed'))::int
        as in_flight_count,
      coalesce(sum(${schema.deposits.amountUsdt})
        filter (where ${schema.deposits.status} not in ('credited', 'failed')), 0)::float8
        as in_flight_usdt
    from ${schema.deposits}
  `);

  const row = rows[0];
  return {
    creditedUsdt: Number(row?.credited_usdt ?? 0),
    inFlightCount: Number(row?.in_flight_count ?? 0),
    inFlightUsdt: Number(row?.in_flight_usdt ?? 0),
  };
}

/** The payout queue's figures. Same reasoning as above. */
export async function readWithdrawalsSummary(
  db: Database,
): Promise<AdminWithdrawalsSummary> {
  const rows = await db.execute<{
    open_count: number;
    open_usdt: number;
    paid_net_inr: number;
  }>(sql`
    select
      count(*) filter (where ${schema.withdrawals.status}
        in ('pending', 'under_review', 'approved', 'processing'))::int as open_count,
      coalesce(sum(${schema.withdrawals.amountUsdt}) filter (where ${schema.withdrawals.status}
        in ('pending', 'under_review', 'approved', 'processing')), 0)::float8 as open_usdt,
      coalesce(sum(${schema.withdrawals.netInr})
        filter (where ${schema.withdrawals.status} = 'paid'), 0)::float8 as paid_net_inr
    from ${schema.withdrawals}
  `);

  const row = rows[0];
  return {
    openCount: Number(row?.open_count ?? 0),
    openUsdt: Number(row?.open_usdt ?? 0),
    paidNetInr: Number(row?.paid_net_inr ?? 0),
  };
}
