import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { Investment } from "@/types";
import type {
  AdminInvestment,
  AdminInvestmentsSummary,
  AdminListQuery,
  PagedResult,
} from "@/types/admin";

import { likePattern, pageTotal, readPage } from "./paginate";
import { toAdminInvestment, toInvestment } from "./mappers";

/** Allocations into plans. */

export async function listInvestmentsForUser(
  db: Database,
  userId: string,
): Promise<Investment[]> {
  const rows = await db
    .select()
    .from(schema.investments)
    .where(eq(schema.investments.userId, userId))
    .orderBy(desc(schema.investments.startedAt));
  return rows.map(toInvestment);
}

/**
 * Every allocation on the platform, with the account it belongs to.
 *
 * The CRM's tables show the holder's name and member id on each row, so the
 * join happens once here rather than as a lookup per rendered row.
 */
export async function listAdminInvestments(
  db: Database,
  options: { limit?: number } = {},
): Promise<AdminInvestment[]> {
  const base = db
    .select({ investment: schema.investments, user: schema.users })
    .from(schema.investments)
    .innerJoin(schema.users, eq(schema.users.id, schema.investments.userId))
    .orderBy(desc(schema.investments.startedAt));
  const rows = options.limit ? await base.limit(options.limit) : await base;

  return rows.map(({ investment, user }) =>
    toAdminInvestment(investment, {
      userName: user.fullName,
      userDisplayId: user.displayId,
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* The paginated allocation list                                               */
/* -------------------------------------------------------------------------- */

function investmentSearchCondition(search: string) {
  if (!search) return undefined;
  const pattern = likePattern(search);
  return or(
    ilike(schema.investments.id, pattern),
    ilike(schema.investments.planName, pattern),
    ilike(schema.users.fullName, pattern),
    ilike(schema.users.email, pattern),
    ilike(schema.users.displayId, pattern),
  );
}

const INVESTMENT_SORTS = {
  recent: () => desc(schema.investments.startedAt),
  oldest: () => asc(schema.investments.startedAt),
  amount: () => desc(schema.investments.amount),
} as const;

/**
 * One page of the allocation list.
 *
 * `query.filter` is a plan id here — the screen's second dimension. It is the
 * one filter token that is not allowlisted, because the set of plans lives in
 * the database rather than in a constant; it reaches SQL as a bound parameter,
 * so an unknown id matches no rows and does nothing else.
 */
export async function pageAdminInvestments(
  db: Database,
  query: AdminListQuery,
): Promise<PagedResult<AdminInvestment>> {
  const where = and(
    query.status === "all"
      ? undefined
      : eq(
          schema.investments.status,
          query.status as (typeof schema.investments.status.enumValues)[number],
        ),
    query.filter === "all"
      ? undefined
      : eq(schema.investments.planId, query.filter),
    investmentSearchCondition(query.search),
  );

  return readPage(query, async (page) => {
    const rows = await db
      .select({
        investment: schema.investments,
        user: schema.users,
        total: pageTotal,
      })
      .from(schema.investments)
      .innerJoin(schema.users, eq(schema.users.id, schema.investments.userId))
      .where(where)
      .orderBy(INVESTMENT_SORTS[query.sort as keyof typeof INVESTMENT_SORTS]())
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);

    return {
      rows: rows.map(({ investment, user }) =>
        toAdminInvestment(investment, {
          userName: user.fullName,
          userDisplayId: user.displayId,
        }),
      ),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

export async function countAdminInvestmentsByStatus(
  db: Database,
  query: AdminListQuery,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: schema.investments.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.investments)
    .innerJoin(schema.users, eq(schema.users.id, schema.investments.userId))
    .where(
      and(
        query.filter === "all"
          ? undefined
          : eq(schema.investments.planId, query.filter),
        investmentSearchCondition(query.search),
      ),
    )
    .groupBy(schema.investments.status);

  const counts: Record<string, number> = { all: 0 };
  for (const row of rows) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }
  return counts;
}

/**
 * The allocation screen's figures. Display aggregates only — see
 * `readDepositsSummary` for why `float8` is acceptable here and nowhere that
 * moves money.
 */
export async function readInvestmentsSummary(
  db: Database,
): Promise<AdminInvestmentsSummary> {
  const rows = await db.execute<{
    active_count: number;
    total_count: number;
    allocated_usdt: number;
    accrued_profit_usdt: number;
  }>(sql`
    select
      count(*) filter (where ${schema.investments.status} = 'active')::int as active_count,
      count(*)::int as total_count,
      coalesce(sum(${schema.investments.amount})
        filter (where ${schema.investments.status} = 'active'), 0)::float8 as allocated_usdt,
      coalesce(sum(${schema.investments.profit}), 0)::float8 as accrued_profit_usdt
    from ${schema.investments}
  `);

  const row = rows[0];
  return {
    activeCount: Number(row?.active_count ?? 0),
    totalCount: Number(row?.total_count ?? 0),
    allocatedUsdt: Number(row?.allocated_usdt ?? 0),
    accruedProfitUsdt: Number(row?.accrued_profit_usdt ?? 0),
  };
}
