import "server-only";

import { splitEvenly, type Decimal } from "@/db/money";
import * as t from "@/db/schema";

/**
 * The reward *schedule* an allocation carries — when the next reward is due,
 * how much it is for, and the full list of periods a fixed-term allocation
 * will actually be credited on.
 *
 * WHY THIS IS A SHARED MODULE AND NOT INLINE
 * ------------------------------------------
 * Three places need the same answer and must not drift: `createInvestment`,
 * which stamps the first schedule onto a new allocation; the settlement job's
 * display refresh, which advances the forecast; and `creditDueEarnings` in
 * `investment-settlement.service`, which is the engine that actually pays.  A
 * second copy of the arithmetic is how a plan starts showing one figure on the
 * allocation card and crediting a different one.
 *
 * NON-COMPOUNDING, BY THE PRODUCT'S OWN RULE
 * -------------------------------------------
 * Every period's share comes from the allocation's *original* principal via
 * `projectedProfit`, computed once at `createInvestment` and never touched
 * again. A credited period never enlarges the base the next one is computed
 * from — that is what "non-compounding" means here, and it is why
 * `earningPeriodsFor` takes the whole schedule as an input and produces it in
 * one pass rather than compounding forward from whatever has already been
 * paid.
 *
 * EXACT, NOT APPROXIMATE
 * -----------------------
 * `splitEvenly()` (`@/db/money`) divides `projectedProfit` into exactly
 * `earningPeriodCount()` shares using integer arithmetic on the schema's
 * smallest unit, so the shares always sum to exactly the total sold — no
 * period is invented and none is lost to rounding. The last period absorbs
 * whatever the truncation of the others leaves, the same way a bank splits a
 * bill that does not divide evenly.
 *
 * WHAT CHANGED FROM THE PROJECTION-ONLY VERSION OF THIS MODULE
 * --------------------------------------------------------------
 * This used to divide by a *fractional* period count
 * (`durationDays ÷ periodDays`, e.g. 12.86 for a 90-day weekly plan) and
 * therefore had no period at all once the last whole boundary passed — the
 * final six days of that example were projected as nothing. That was
 * defensible while nothing was ever actually credited (CLAUDE.md's older
 * text called this "emphatically not a payment"), but paying real periods
 * that way would leave part of the profit a plan is sold on permanently
 * unpaid. `earningPeriodCount()` uses a *whole* number of periods
 * (`ceil(durationDays ÷ periodDays)`), and the last one's due date is
 * `maturesAt` itself rather than a boundary that could fall after it — so the
 * schedule always covers the whole term and the whole profit, and the display
 * forecast (`rewardScheduleFor`) reads it from the same source the engine
 * pays from instead of approximating it separately.
 */

export type RewardFrequency = (typeof t.rewardFrequencyEnum.enumValues)[number];

/** How many days one reward period spans. `on_maturity` is the whole term. */
const PERIOD_DAYS: Record<Exclude<RewardFrequency, "on_maturity">, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export interface RewardSchedule {
  /** When the next reward falls due, or null once there are none left. */
  nextRewardAt: Date | null;
  /** The exact size of that reward, or null when there is none. */
  nextRewardAmount: number | null;
}

/** One scheduled earning period, in the order it will be credited. */
export interface EarningPeriod {
  /** 1-based, counted from the allocation's own `startedAt`. */
  index: number;
  /** The idempotency key `recordInvestmentEarning()` writes it under. */
  periodKey: string;
  /** When this period becomes due. The final period is always `maturesAt`. */
  dueAt: Date;
  /** This period's exact, non-compounding share of `projectedProfit`. */
  amount: Decimal;
}

/**
 * How many discrete reward periods a fixed-term allocation has.
 *
 * A whole number, always at least one: `ceil(durationDays ÷ periodDays)`, not
 * the fractional count the old forecast-only version used — see the module
 * comment for why a whole count is what makes the *last* period exist at all.
 * `on_maturity` is one period by definition, the term itself.
 */
export function earningPeriodCount(
  durationDays: number,
  rewardFrequency: RewardFrequency,
): number {
  if (rewardFrequency === "on_maturity") return 1;
  const periodDays = PERIOD_DAYS[rewardFrequency];
  return Math.max(Math.ceil(durationDays / periodDays), 1);
}

/** The deterministic, order-based key a period is credited under. */
export function periodKeyFor(periodIndex: number): string {
  return `p${periodIndex}`;
}

/**
 * The full schedule of earning periods for a fixed-term allocation — due
 * dates and exact amounts, in order.
 *
 * Pure and total: the same allocation always produces the same list, which is
 * what lets both the settlement engine and the display forecast call it
 * without disagreeing. Not defined for an open-ended allocation (§ below) —
 * callers must check `isOpenEnded()` first, the same guard `matureInvestment`'s
 * caller already applies.
 */
export function earningPeriodsFor(investment: {
  startedAt: Date;
  maturesAt: Date;
  durationDays: number;
  rewardFrequency: RewardFrequency;
  projectedProfit: Decimal;
}): EarningPeriod[] {
  const totalPeriods = earningPeriodCount(
    investment.durationDays,
    investment.rewardFrequency,
  );
  const amounts = splitEvenly(investment.projectedProfit, totalPeriods);
  const periodDays =
    investment.rewardFrequency === "on_maturity"
      ? null
      : PERIOD_DAYS[investment.rewardFrequency];

  return amounts.map((amount, i) => {
    const index = i + 1;
    // Every period up to the last one lands on its calendar boundary from
    // `startedAt`; the last one is pinned to `maturesAt` itself rather than a
    // boundary that could land after it (a 90-day term paying weekly has its
    // 13th boundary on day 91) or, for `on_maturity`, because the term itself
    // is the only date the plan ever named.
    const dueAt =
      index === totalPeriods || periodDays === null
        ? investment.maturesAt
        : addDays(investment.startedAt, index * periodDays);
    return { index, periodKey: periodKeyFor(index), dueAt, amount };
  });
}

/**
 * The schedule for an allocation, as of `asOf` — a forecast for display, read
 * from the same period list the engine actually credits from.
 *
 * Pure and total: given the same allocation, the same credited-period count
 * and the same instant it always returns the same answer, which is what lets
 * the settlement job's display refresh recompute rather than increment. An
 * incrementing job that misses a run drifts; a job that recomputes from
 * `startedAt` cannot.
 */
export function rewardScheduleFor(
  investment: {
    startedAt: Date;
    maturesAt: Date;
    durationDays: number;
    projectedProfit: Decimal;
    rewardFrequency: RewardFrequency;
    /** How many periods `creditDueEarnings` has already settled. */
    earningsCreditedPeriods: number;
  },
  asOf: Date,
): RewardSchedule {
  /*
   * AN OPEN-ENDED ALLOCATION HAS NO MATURITY AND NO KNOWN PER-PERIOD AMOUNT
   * ----------------------------------------------------------------------
   * `duration_days: 0` is a real product, not a missing value: Flexible Reserve
   * is sold as "no fixed term — funds stay allocated until you withdraw them".
   * `createInvestment` computes `matures_at = started_at + 0 days`, so such a
   * row looks, to any arithmetic that trusts `matures_at`, like it matured the
   * instant it was created. It has not. `isOpenEnded()` is what keeps the
   * settlement job from force-returning the principal of a product whose whole
   * selling point is that the customer chooses when.
   *
   * The *date* is still knowable — the frequency says daily — so it is
   * returned. The **amount is not**: the plan's copy calls 4.5% a "projected
   * annualised rate", and nothing in the schema records the horizon that
   * `estimated_return_percent` is measured over. Dividing by a term of zero
   * would pay the entire projected profit every single day. So the amount is
   * null, the UI shows a date without a figure, and there is nothing for
   * `creditDueEarnings` to schedule either — Flexible Reserve is excluded from
   * it the same way it is excluded from maturity.
   */
  if (isOpenEnded(investment.durationDays)) {
    if (investment.rewardFrequency === "on_maturity") {
      // No maturity to pay on. A contradiction in the plan's own terms; there
      // is nothing honest to return.
      return { nextRewardAt: null, nextRewardAmount: null };
    }
    return {
      nextRewardAt: nextBoundary(
        investment.startedAt,
        PERIOD_DAYS[investment.rewardFrequency],
        asOf,
      ),
      nextRewardAmount: null,
    };
  }

  // Nothing is due after the term ends; maturity settles the principal instead.
  if (asOf >= investment.maturesAt) {
    return { nextRewardAt: null, nextRewardAmount: null };
  }

  const periods = earningPeriodsFor(investment);
  const next = periods[investment.earningsCreditedPeriods];
  if (!next) return { nextRewardAt: null, nextRewardAmount: null };

  return { nextRewardAt: next.dueAt, nextRewardAmount: Number(next.amount) };
}

/**
 * How far through its term an allocation is, in whole days.
 *
 * Clamped to the term: an allocation past its maturity date reads as complete
 * rather than as 104 days of a 90-day plan, which is what an unclamped
 * difference would show for anything the settlement job has not reached yet.
 */
export function elapsedDaysFor(
  investment: { startedAt: Date; durationDays: number },
  asOf: Date,
): number {
  const elapsed = Math.max(Math.floor(daysBetween(investment.startedAt, asOf)), 0);
  // An open-ended allocation has no term to be a fraction of, so there is
  // nothing to clamp to — the number simply counts up.
  if (isOpenEnded(investment.durationDays)) return elapsed;
  return Math.min(elapsed, investment.durationDays);
}

/**
 * Whether an allocation runs until the customer ends it rather than to a date.
 *
 * The single test, used by the schedule above and by the settlement job, so the
 * two cannot disagree about which rows have a maturity.
 */
export function isOpenEnded(durationDays: number): boolean {
  return durationDays <= 0;
}

/**
 * The next period boundary strictly after `asOf`.
 *
 * `floor + 1` rather than `ceil`, because on an exact boundary the reward for
 * *that* period has just fallen due and the next one is a period later.
 */
function nextBoundary(startedAt: Date, periodDays: number, asOf: Date): Date {
  const elapsed = daysBetween(startedAt, asOf);
  const nextPeriodIndex = Math.floor(elapsed / periodDays) + 1;
  return addDays(startedAt, nextPeriodIndex * periodDays);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_DAY;
}

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * MS_PER_DAY);
}
