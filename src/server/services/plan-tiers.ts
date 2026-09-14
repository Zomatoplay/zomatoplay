import "server-only";

/**
 * Resolving and validating a plan's amount-banded rate ladder.
 *
 * WHY THIS FILE TOUCHES NO DATABASE
 * ---------------------------------
 * Everything here is a pure function of a ladder and an amount. That is
 * deliberate: this is the code that decides what rate somebody's money is sold
 * at, so it has to be testable exhaustively at the boundaries — 9.99, 10,
 * 10.01, 49.99, 50, 100 — without a database, a session or a transaction in
 * the way. The write service calls it inside its own transaction; the CRM's
 * preview calls it through a server action. **There is exactly one
 * implementation, and the browser never runs it** — the `server-only` import
 * above makes a stray client import a build failure rather than a second
 * pricing rule shipped to a browser. A tier the client resolved is a display
 * hint; `createInvestment` resolves it again against the rows Postgres holds.
 *
 * THE BOUNDARY RULE: `[min, max)`
 * -------------------------------
 * Half-open, lower bound inclusive, upper bound exclusive. So a ladder of
 * `10–50`, `50–100`, `100+` puts 49.99 in the first band, 50.00 in the second
 * and 100.00 in the third, and no amount is ever in two bands. The alternative
 * — inclusive on both ends — makes 50 ambiguous, and an ambiguity in a rate
 * table is a dispute waiting to be had.
 *
 * ARITHMETIC
 * ----------
 * Every comparison goes through `compare()` from `@/db/money`, which scales to
 * integer units and compares exactly. `49.99 < 50` is obvious; `0.1 + 0.2` is
 * not, and a float comparison at a band edge would put a fraction of a cent on
 * the wrong side of a rate change.
 */

import { compare, decimalFrom, isNegative, ZERO, type Decimal } from "@/db/money";

/**
 * One band, in the shape both the database row and an operator's unsaved draft
 * can produce. `id` is absent on a draft the CRM has not written yet.
 */
export interface PlanRateTierInput {
  id?: string;
  /** Inclusive lower bound. */
  minAmountUsdt: number;
  /** Exclusive upper bound; `null` means open-ended. */
  maxAmountUsdt: number | null;
  ratePercent: number;
  active: boolean;
}

/** A band as it reaches a screen. Same shape, id guaranteed. */
export interface PlanRateTier extends PlanRateTierInput {
  id: string;
}

export interface ResolvedTier {
  /** Null when the plan has no ladder and its own rate was used instead. */
  tierId: string | null;
  minAmountUsdt: number | null;
  maxAmountUsdt: number | null;
  ratePercent: number;
  /** Where the rate came from, so a screen never has to guess. */
  source: "tier" | "plan";
}

export class PlanTierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanTierError";
  }
}

/** Ladder order is by lower bound, always. Never by insertion or by id. */
export function sortTiers<T extends PlanRateTierInput>(tiers: readonly T[]): T[] {
  return [...tiers].sort(
    (a, b) => compareAmounts(a.minAmountUsdt, b.minAmountUsdt),
  );
}

/**
 * The band that covers `amount`, or null.
 *
 * Inactive bands are skipped: deactivating one is how an operator withdraws a
 * band without destroying the evidence an allocation that cited it needs.
 * Skipping rather than falling through to a neighbour is the honest behaviour —
 * a hole in the ladder must be visible as a refusal, not silently papered over
 * with whichever band happens to be adjacent.
 */
export function findTierForAmount(
  tiers: readonly PlanRateTier[],
  amount: Decimal,
): PlanRateTier | null {
  for (const tier of sortTiers(tiers)) {
    if (!tier.active) continue;
    if (compare(amount, decimalFrom(tier.minAmountUsdt)) < 0) continue;
    if (
      tier.maxAmountUsdt !== null &&
      compare(amount, decimalFrom(tier.maxAmountUsdt)) >= 0
    ) {
      continue;
    }
    return tier;
  }
  return null;
}

/**
 * The rate an allocation of `amount` into this plan is sold at.
 *
 * Three outcomes, and the middle one is the one worth being careful about:
 *
 * - **No ladder configured** → the plan's own `estimatedReturnPercent`, with
 *   `source: "plan"`. Every plan that existed before this feature is in this
 *   case, and it is why adding the ladder changed nothing about them.
 * - **A ladder, and a band covers the amount** → that band's rate.
 * - **A ladder, and no band covers the amount** → a refusal. *Not* a silent
 *   fall back to the plan rate: an operator who configured a ladder has said
 *   what each amount is sold at, and an amount they did not cover is a
 *   configuration gap somebody has to see. Quietly selling it at the plan's
 *   headline rate would hide the gap behind a number nobody chose.
 */
export function resolveRateForAmount(
  plan: { estimatedReturnPercent: number; name: string },
  tiers: readonly PlanRateTier[],
  amount: Decimal,
): ResolvedTier {
  const active = tiers.filter((tier) => tier.active);
  if (active.length === 0) {
    return {
      tierId: null,
      minAmountUsdt: null,
      maxAmountUsdt: null,
      ratePercent: plan.estimatedReturnPercent,
      source: "plan",
    };
  }

  const tier = findTierForAmount(tiers, amount);
  if (!tier) {
    throw new PlanTierError(
      `${plan.name} has no rate tier covering ${amount} USDT. ` +
        `Choose an amount inside one of the plan's bands.`,
    );
  }

  return {
    tierId: tier.id,
    minAmountUsdt: tier.minAmountUsdt,
    maxAmountUsdt: tier.maxAmountUsdt,
    ratePercent: tier.ratePercent,
    source: "tier",
  };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every reason a ladder is not a valid ladder, as messages an operator can act
 * on.
 *
 * Returns *all* of them rather than throwing on the first: a form that reports
 * one problem per save is a form somebody saves four times.
 *
 * `active` is not consulted anywhere here, and that is deliberate. Two
 * overlapping bands where one is inactive resolve unambiguously *today*, and
 * become ambiguous the moment somebody re-activates it — at which point the
 * form that would have caught it is long closed. The ladder is checked as
 * written, not as currently switched on.
 */
export function validateTierLadder(
  tiers: readonly PlanRateTierInput[],
  plan?: { minInvestment: number; maxInvestment: number; name: string },
): string[] {
  const problems: string[] = [];
  if (tiers.length === 0) return problems;

  for (const tier of tiers) {
    const label = describeBand(tier);
    if (!Number.isFinite(tier.minAmountUsdt) || isNegativeAmount(tier.minAmountUsdt)) {
      problems.push(`${label}: the lower bound must be zero or more.`);
    }
    if (tier.maxAmountUsdt !== null) {
      if (!Number.isFinite(tier.maxAmountUsdt)) {
        problems.push(`${label}: the upper bound is not a number.`);
      } else if (compareAmounts(tier.maxAmountUsdt, tier.minAmountUsdt) <= 0) {
        problems.push(
          `${label}: the upper bound must be above the lower bound.`,
        );
      }
    }
    if (!Number.isFinite(tier.ratePercent) || tier.ratePercent <= 0) {
      problems.push(`${label}: the rate must be above zero.`);
    }
  }

  const sorted = sortTiers(tiers);

  // Duplicate lower bounds. Checked before overlap because two bands starting
  // at the same amount produce a confusing overlap message otherwise.
  for (let i = 1; i < sorted.length; i += 1) {
    if (compareAmounts(sorted[i].minAmountUsdt, sorted[i - 1].minAmountUsdt) === 0) {
      problems.push(
        `Two tiers both start at ${sorted[i].minAmountUsdt} USDT. Each tier must start at a different amount.`,
      );
    }
  }

  // Overlap and gap, band against its successor. `[a, b)` and `[b, c)` touch
  // without overlapping, which is why the comparison is `>` and `<` rather
  // than `>=` and `<=`.
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const current = sorted[i];
    const next = sorted[i + 1];

    if (current.maxAmountUsdt === null) {
      problems.push(
        `${describeBand(current)} is open-ended but is not the highest tier. ` +
          `Only the top tier may have no upper bound.`,
      );
      continue;
    }
    const order = compareAmounts(current.maxAmountUsdt, next.minAmountUsdt);
    if (order > 0) {
      problems.push(
        `${describeBand(current)} overlaps ${describeBand(next)}. Tiers must not overlap.`,
      );
    } else if (order < 0) {
      problems.push(
        `Nothing covers ${current.maxAmountUsdt}–${next.minAmountUsdt} USDT. ` +
          `Tiers must be contiguous: each one starts where the previous ends.`,
      );
    }
  }

  /*
   * The ladder against the plan's own limits.
   *
   * A ladder that starts above the plan's minimum, or ends below its maximum,
   * leaves amounts the plan accepts and the ladder cannot price — which
   * `resolveRateForAmount` correctly refuses, at the moment a customer presses
   * confirm. Catching it in the CRM is where it costs nobody anything.
   */
  if (plan && sorted.length > 0) {
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    if (compareAmounts(lowest.minAmountUsdt, plan.minInvestment) > 0) {
      problems.push(
        `The lowest tier starts at ${lowest.minAmountUsdt} USDT but ${plan.name} accepts ` +
          `allocations from ${plan.minInvestment} USDT. Amounts between the two could not be priced.`,
      );
    }
    if (
      highest.maxAmountUsdt !== null &&
      compareAmounts(highest.maxAmountUsdt, plan.maxInvestment) <= 0
    ) {
      problems.push(
        `The highest tier ends at ${highest.maxAmountUsdt} USDT but ${plan.name} accepts ` +
          `allocations up to ${plan.maxInvestment} USDT. Leave the top tier's upper bound ` +
          `empty to make it open-ended.`,
      );
    }
  }

  return problems;
}

/** `10–50 USDT` / `100+ USDT`. Used in every message above. */
export function describeBand(tier: PlanRateTierInput): string {
  return tier.maxAmountUsdt === null
    ? `${tier.minAmountUsdt}+ USDT`
    : `${tier.minAmountUsdt}–${tier.maxAmountUsdt} USDT`;
}

/**
 * Exact comparison of two amounts that arrived as `number`.
 *
 * The money columns are read back as `number` (see `@/db/schema/columns`), so
 * a ladder in hand is numbers — but the comparisons here decide which rate
 * applies, and `decimalFrom` refuses anything not exactly representable at the
 * schema's scale rather than rounding it into a band.
 */
function compareAmounts(a: number, b: number): -1 | 0 | 1 {
  return compare(decimalFrom(a), decimalFrom(b));
}

function isNegativeAmount(value: number): boolean {
  if (!Number.isFinite(value)) return false;
  const amount = decimalFrom(value);
  return isNegative(amount) && compare(amount, ZERO) !== 0;
}
