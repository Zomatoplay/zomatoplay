import "server-only";

import { and, eq, gte, inArray, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";

/**
 * Earnings, read from the ledger.
 *
 * WHAT COUNTS AS AN EARNING
 * -------------------------
 * A settled credit of type `reward` or `referral`, and nothing else. Deposits
 * are the user's own money arriving, an investment is it moving, a withdrawal
 * is it leaving; none of them is profit. `status = 'completed'` excludes a
 * pending or reversed entry, so the total never counts money that has not
 * actually landed.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not an accrual curve. The ledger records rewards when they settle —
 * weekly, monthly or at maturity depending on the plan — so the series below is
 * *what was credited*, bucketed by day and by month. A daily accrual model
 * would draw a smoother line and would be an invention: no service computes it,
 * and putting a made-up number under "Earnings" is exactly the kind of figure a
 * financial UI must not display.
 *
 * The bucketing is done in Postgres rather than in JavaScript so the sums are
 * `numeric` arithmetic on `numeric` columns; only the finished totals cross
 * into a JavaScript number, and only to be rendered.
 */

const EARNING_TYPES = ["reward", "referral"] as const;

/** Zero across the board — a new account, and the honest answer for one. */
export const NO_EARNINGS = {
  total: 0,
  byDay: [] as { day: string; value: number }[],
  byMonth: [] as { month: string; value: number }[],
};

export interface EarningsRollup {
  /** Every settled reward and commission this account has ever received. */
  total: number;
  /** `YYYY-MM-DD` → amount, ascending, for the trailing window requested. */
  byDay: { day: string; value: number }[];
  /** `YYYY-MM` → amount, ascending. */
  byMonth: { month: string; value: number }[];
}

export async function readEarnings(
  db: Database,
  userId: string,
  options: { dayWindow: number; monthWindow: number },
): Promise<EarningsRollup> {
  const scope = and(
    eq(schema.transactions.userId, userId),
    inArray(schema.transactions.type, [...EARNING_TYPES]),
    eq(schema.transactions.status, "completed"),
  );

  const dayFloor = new Date();
  dayFloor.setUTCHours(0, 0, 0, 0);
  dayFloor.setUTCDate(dayFloor.getUTCDate() - (options.dayWindow - 1));

  const monthFloor = new Date();
  monthFloor.setUTCHours(0, 0, 0, 0);
  monthFloor.setUTCDate(1);
  monthFloor.setUTCMonth(monthFloor.getUTCMonth() - (options.monthWindow - 1));

  const [totals, byDay, byMonth] = await Promise.all([
    db
      .select({
        // `::float8` only at the very end: the sum itself is exact numeric.
        total: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)::float8`,
      })
      .from(schema.transactions)
      .where(scope),

    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${schema.transactions.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD')`,
        value: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)::float8`,
      })
      .from(schema.transactions)
      .where(and(scope, gte(schema.transactions.occurredAt, dayFloor)))
      .groupBy(sql`1`)
      .orderBy(sql`1`),

    db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${schema.transactions.occurredAt} at time zone 'UTC'), 'YYYY-MM')`,
        value: sql<number>`coalesce(sum(${schema.transactions.amount}), 0)::float8`,
      })
      .from(schema.transactions)
      .where(and(scope, gte(schema.transactions.occurredAt, monthFloor)))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);

  return {
    total: totals[0]?.total ?? 0,
    byDay,
    byMonth,
  };
}
