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

  /*
   * THREE ROLLUPS, ONE ROUND TRIP.
   *
   * These were three statements. Issued in parallel they cost one round trip
   * between them — but only if the pool has three free connections at that
   * moment, and Home asks for nine reads at once against a pool of eight. Two
   * of the three were the queries that did not fit, so Home paid a second wave
   * (~350ms) for them alone.
   *
   * Unioning them is not a micro-optimisation of the query plan: all three scan
   * the same rows of the same table with the same predicate, so this asks
   * Postgres for the work it was already doing, once, over one connection.
   *
   * Every sum is still `numeric` arithmetic on a `numeric` column, cast to
   * `float8` only at the end — the property the separate queries had, and the
   * one that matters. `bucket` is null on the total row and a `YYYY-MM-DD` or
   * `YYYY-MM` label on the others.
   */
  const rows = await db.execute<{
    kind: "total" | "day" | "month";
    bucket: string | null;
    value: number;
  }>(sql`
    select 'total' as kind, null::text as bucket,
           coalesce(sum(${schema.transactions.amount}), 0)::float8 as value
      from ${schema.transactions}
     where ${scope}
    union all
    select 'day',
           to_char(date_trunc('day', ${schema.transactions.occurredAt} at time zone 'UTC'), 'YYYY-MM-DD'),
           coalesce(sum(${schema.transactions.amount}), 0)::float8
      from ${schema.transactions}
     where ${and(scope, gte(schema.transactions.occurredAt, dayFloor))}
     group by 2
    union all
    select 'month',
           to_char(date_trunc('month', ${schema.transactions.occurredAt} at time zone 'UTC'), 'YYYY-MM'),
           coalesce(sum(${schema.transactions.amount}), 0)::float8
      from ${schema.transactions}
     where ${and(scope, gte(schema.transactions.occurredAt, monthFloor))}
     group by 2
  `);

  let total = 0;
  const byDay: EarningsRollup["byDay"] = [];
  const byMonth: EarningsRollup["byMonth"] = [];

  for (const row of rows) {
    if (row.kind === "total") {
      total = row.value;
    } else if (row.kind === "day" && row.bucket) {
      byDay.push({ day: row.bucket, value: row.value });
    } else if (row.kind === "month" && row.bucket) {
      byMonth.push({ month: row.bucket, value: row.value });
    }
  }

  // Ordered here rather than in SQL: a `UNION ALL` orders the whole result or
  // nothing, and these are two independent series of at most a few rows each.
  // The labels are zero-padded, so lexical order is chronological order.
  byDay.sort((a, b) => a.day.localeCompare(b.day));
  byMonth.sort((a, b) => a.month.localeCompare(b.month));

  return { total, byDay, byMonth };
}
