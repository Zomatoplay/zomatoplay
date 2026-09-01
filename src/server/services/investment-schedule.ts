import "server-only";

import * as t from "@/db/schema";

/**
 * The reward *schedule* an allocation carries — when the next reward is due and
 * how much it is projected to be.
 *
 * WHY THIS IS A SHARED MODULE AND NOT INLINE
 * ------------------------------------------
 * Two places need the same answer and must not drift: `createInvestment`, which
 * stamps the first schedule onto a new allocation, and the settlement job,
 * which advances it. A second copy of the arithmetic is how a plan starts
 * showing one figure on the allocation card and a different one after the first
 * tick.
 *
 * THE FORMULA IS READ FROM THE EXISTING DATA, NOT INVENTED
 * --------------------------------------------------------
 * Every seeded allocation already carries the answer, and the arithmetic that
 * produces it is unambiguous. Balanced Growth: 90 days, weekly, 300 USDT
 * projected profit. 90 ÷ 7 = 12.86 periods; 300 ÷ 12.86 = 23.33, and the seed
 * says `nextRewardAmount: 23.4`. Same for the daily and monthly plans. So the
 * projected per-period reward is
 *
 *     projectedProfit ÷ (durationDays ÷ periodDays)
 *
 * and this module is where that lives.
 *
 * WHAT THIS IS EMPHATICALLY NOT
 * -----------------------------
 * A payment. It is a **projection**, which is the only thing this codebase's
 * data supports: a plan sells an `estimatedReturnRange`, and
 * `estimatedReturnPercent` is a point inside it. Nothing anywhere defines what
 * an allocation *actually* earns, so nothing here credits anything — see the
 * note at the top of `investment-settlement.service`. `next_reward_amount` is
 * a forecast displayed to the user, and the language rules in CLAUDE.md §10
 * apply to it.
 */

type RewardFrequency = (typeof t.rewardFrequencyEnum.enumValues)[number];

/** How many days one reward period spans. `on_maturity` is the whole term. */
const PERIOD_DAYS: Record<Exclude<RewardFrequency, "on_maturity">, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
};

export interface RewardSchedule {
  /** When the next reward falls due, or null once there are none left. */
  nextRewardAt: Date | null;
  /** The projected size of that reward, or null when there is none. */
  nextRewardAmount: number | null;
}

/**
 * The schedule for an allocation, as of `asOf`.
 *
 * Pure and total: given the same allocation and the same instant it always
 * returns the same answer, which is what lets the settlement job recompute
 * rather than increment. An incrementing job that misses a run drifts; a job
 * that recomputes from `startedAt` cannot.
 */
export function rewardScheduleFor(
  investment: {
    startedAt: Date;
    maturesAt: Date;
    durationDays: number;
    projectedProfit: number;
    rewardFrequency: RewardFrequency;
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
   * null, the UI shows a date without a figure, and the missing rule is
   * reported rather than guessed.
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

  if (investment.rewardFrequency === "on_maturity") {
    // One payment, at the end. The date is the maturity date itself.
    return {
      nextRewardAt: investment.maturesAt,
      nextRewardAmount: round8(investment.projectedProfit),
    };
  }

  const periodDays = PERIOD_DAYS[investment.rewardFrequency];
  // At least one period, so a term shorter than its own reward interval still
  // has a schedule rather than dividing by zero.
  const periods = Math.max(investment.durationDays / periodDays, 1);

  const nextRewardAt = nextBoundary(investment.startedAt, periodDays, asOf);

  /*
   * A boundary *past* maturity is not a reward date — the term ends first.
   *
   * Strictly greater, not `>=`, and the difference is a real case rather than
   * pedantry: a 30-day plan paying monthly has exactly one period, and its
   * boundary lands precisely on the maturity date. With `>=` that plan got no
   * schedule at all — `next_reward_at` null from the moment the allocation was
   * created, which is the very null this module exists to stop. The reward is
   * genuinely due at maturity, so the date is kept; the guard at the top of the
   * function is what makes it null once the term is actually over.
   */
  if (nextRewardAt > investment.maturesAt) {
    return { nextRewardAt: null, nextRewardAmount: null };
  }

  return {
    nextRewardAt,
    nextRewardAmount: round8(investment.projectedProfit / periods),
  };
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

/**
 * Rounded to the `usdt` column's scale.
 *
 * This is a *forecast* rather than a money movement, so it is computed in
 * JavaScript rather than in Postgres — the rule in CLAUDE.md §17.2 governs
 * amounts that move a balance, and nothing here does. Rounding to the column's
 * eight places keeps the stored value and the displayed value identical.
 */
function round8(value: number): number {
  return Number(value.toFixed(8));
}
