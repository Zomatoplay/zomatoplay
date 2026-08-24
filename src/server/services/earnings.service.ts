import "server-only";

import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";

import { getDb, isDatabaseConfigured } from "@/db";
import type { EarningsPoint, EarningsSummary } from "@/types";

import { AccountUnavailableError } from "./account.service";
import { requireCurrentUserIdForPage } from "../current-user";
import { readEarnings, type EarningsRollup } from "../repositories/earnings.repository";

/**
 * Earnings reporting, per account, from that account's own ledger.
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 * ---------------------------------
 * These two reads used to return a constant from `@/data/investments` — one
 * specific demo person's earnings curve, served to every visitor including a
 * brand-new account with an empty wallet. A registered user saw 842.35 USDT of
 * lifetime profit they had never made, on the home screen, above their real
 * balance of zero. That is the worst kind of wrong number: plausible, prominent,
 * and about money.
 *
 * WHAT IS REPORTED
 * ----------------
 * Settled `reward` and `referral` credits, bucketed by the day and month they
 * were credited. Not an accrual model — see the repository for why inventing
 * one here would be worse than reporting what actually settled.
 *
 * A new account reports zeros, which is correct and is what §31 of the brief
 * asks for. There is no fallback to seed data: a user-scoped read has no
 * business answering with somebody else's figures.
 */

/** Seven days are charted; fourteen are read, so "vs last week" is a real sum. */
const CHART_DAYS = 7;
const DAY_WINDOW = CHART_DAYS * 2;
const MONTH_WINDOW = 6;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/**
 * The three bucketing queries, run once per request per account.
 *
 * Wallet renders both the summary and the month-by-month breakdown, and both
 * are built from the same rollup — so without this the page issued six queries
 * where three would do. `cache()` is keyed on the resolved id, which is why
 * `rollup` resolves the session first and delegates: `getEarningsSummary()` and
 * `getEarningsSummary(id)` would otherwise be two different cache entries and
 * share nothing.
 */
const cachedRollup = cache(async (id: string): Promise<EarningsRollup> => {
  noStore();
  return readEarnings(getDb(), id, {
    dayWindow: DAY_WINDOW,
    monthWindow: MONTH_WINDOW,
  });
});

async function rollup(userId?: string): Promise<EarningsRollup> {
  // Page-only: Home and Wallet. A missing session redirects, never throws.
  const id = userId ?? (await requireCurrentUserIdForPage());
  if (!isDatabaseConfigured()) {
    throw new AccountUnavailableError(
      "No DATABASE_URL is configured. Earnings have no source, and the seed " +
        "modules are not one — they describe a single demo person.",
    );
  }
  return cachedRollup(id);
}

/** `YYYY-MM-DD` for a day offset back from UTC midnight today. */
function dayKey(today: Date, daysBack: number): string {
  const date = new Date(today);
  date.setUTCDate(date.getUTCDate() - daysBack);
  return date.toISOString().slice(0, 10);
}

/** Percentage change, or zero when the previous period had nothing to compare. */
function changePercent(current: number, previous: number): number {
  if (previous <= 0) return 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

export async function getEarningsSummary(userId?: string): Promise<EarningsSummary> {
  const data = await rollup(userId);

  const byDay = new Map(data.byDay.map((row) => [row.day, row.value]));
  const byMonth = new Map(data.byMonth.map((row) => [row.month, row.value]));

  // A dense series: a day with no reward is a zero on the chart, not a gap.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const weekly: EarningsPoint[] = [];
  let thisWeek = 0;
  for (let offset = CHART_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - offset);
    const value = round(byDay.get(dayKey(today, offset)) ?? 0);
    thisWeek += value;
    weekly.push({ label: WEEKDAY[date.getUTCDay()], value });
  }

  // The seven days before those seven — a real sum from the same query, not an
  // estimate. A comparison is only worth showing if it is measured.
  let previousWeek = 0;
  for (let offset = DAY_WINDOW - 1; offset >= CHART_DAYS; offset -= 1) {
    previousWeek += byDay.get(dayKey(today, offset)) ?? 0;
  }

  const monthly: EarningsPoint[] = [];
  for (let offset = MONTH_WINDOW - 1; offset >= 0; offset -= 1) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1),
    );
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    monthly.push({
      label: MONTH_SHORT[date.getUTCMonth()],
      value: round(byMonth.get(key) ?? 0),
    });
  }

  const thisMonth = monthly[monthly.length - 1]?.value ?? 0;
  const lastMonth = monthly[monthly.length - 2]?.value ?? 0;

  return {
    thisWeek: round(thisWeek),
    thisMonth,
    lastMonth,
    total: round(data.total),
    weekChangePercent: changePercent(thisWeek, previousWeek),
    monthChangePercent: changePercent(thisMonth, lastMonth),
    weekly,
    monthly,
  };
}

export interface MonthlyEarningsRow {
  month: string;
  amount: number;
  /** The month still in progress, so the figure will keep moving. */
  partial: boolean;
}

/** Previous-month breakdown shown in Wallet → Earnings. Newest first. */
export async function getMonthlyEarningsHistory(
  userId?: string,
): Promise<MonthlyEarningsRow[]> {
  const data = await rollup(userId);
  const byMonth = new Map(data.byMonth.map((row) => [row.month, row.value]));

  const today = new Date();
  const rows: MonthlyEarningsRow[] = [];

  for (let offset = 0; offset < MONTH_WINDOW; offset += 1) {
    const date = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1),
    );
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    rows.push({
      month: `${MONTH_LONG[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      amount: round(byMonth.get(key) ?? 0),
      partial: offset === 0,
    });
  }

  return rows;
}
