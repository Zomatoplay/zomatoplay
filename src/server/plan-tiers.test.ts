import assert from "node:assert/strict";
import test from "node:test";

import { decimal } from "@/db/money";
import {
  findTierForAmount,
  PlanTierError,
  resolveRateForAmount,
  sortTiers,
  validateTierLadder,
  type PlanRateTier,
} from "@/server/services/plan-tiers";

/**
 * The rate ladder, at its boundaries.
 *
 * This file has no database because `plan-tiers.ts` has none: the code that
 * decides what rate somebody's money is sold at is a pure function, so every
 * edge of every band can be asserted directly. The amounts below are the ones
 * a dispute would be about — 49.99 against 50, 99.99 against 100 — and the
 * half-open `[min, max)` rule is what makes each of them have exactly one
 * answer.
 */

const LADDER: PlanRateTier[] = [
  { id: "t1", minAmountUsdt: 10, maxAmountUsdt: 50, ratePercent: 2, active: true },
  { id: "t2", minAmountUsdt: 50, maxAmountUsdt: 100, ratePercent: 3, active: true },
  { id: "t3", minAmountUsdt: 100, maxAmountUsdt: null, ratePercent: 5, active: true },
];

const PLAN = { estimatedReturnPercent: 8, name: "Test Plan" };

function tierFor(amount: string): string | null {
  const tier = findTierForAmount(LADDER, decimal(amount));
  return tier ? tier.id : null;
}

test("half-open bands: every boundary resolves to exactly one tier", () => {
  // Below the ladder entirely.
  assert.equal(tierFor("0"), null);
  assert.equal(tierFor("9.99"), null);
  assert.equal(tierFor("9.99999999"), null);

  // First band: inclusive at 10, exclusive at 50.
  assert.equal(tierFor("10"), "t1");
  assert.equal(tierFor("10.01"), "t1");
  assert.equal(tierFor("49.99"), "t1");
  assert.equal(tierFor("49.99999999"), "t1");

  // Second band: 50 belongs here, not to the band that ends at 50.
  assert.equal(tierFor("50"), "t2");
  assert.equal(tierFor("50.01"), "t2");
  assert.equal(tierFor("99.99"), "t2");
  assert.equal(tierFor("99.99999999"), "t2");

  // Open-ended top band.
  assert.equal(tierFor("100"), "t3");
  assert.equal(tierFor("100.01"), "t3");
  assert.equal(tierFor("1000000"), "t3");
  assert.equal(tierFor("999999999999.99999999"), "t3");
});

test("the smallest representable step either side of a boundary lands on different tiers", () => {
  // 1e-8 is the schema's scale. If comparison were done in float64 these two
  // could both land on the same side, which is the whole reason `compare()`
  // scales to integer units.
  assert.equal(tierFor("49.99999999"), "t1");
  assert.equal(tierFor("50.00000001"), "t2");
  assert.equal(tierFor("99.99999999"), "t2");
  assert.equal(tierFor("100.00000001"), "t3");
});

test("an inactive tier is skipped, and its range is not absorbed by a neighbour", () => {
  const ladder: PlanRateTier[] = [
    LADDER[0],
    { ...LADDER[1], active: false },
    LADDER[2],
  ];
  assert.equal(findTierForAmount(ladder, decimal("40"))?.id, "t1");
  // 75 was priced by the deactivated band. Nothing else covers it, and the
  // neighbouring bands must not quietly take it.
  assert.equal(findTierForAmount(ladder, decimal("75")), null);
  assert.equal(findTierForAmount(ladder, decimal("150"))?.id, "t3");
});

test("ordering is by lower bound, whatever order the rows arrive in", () => {
  const shuffled = [LADDER[2], LADDER[0], LADDER[1]];
  assert.deepEqual(
    sortTiers(shuffled).map((tier) => tier.id),
    ["t1", "t2", "t3"],
  );
  // …and resolution does not depend on input order either.
  assert.equal(findTierForAmount(shuffled, decimal("50"))?.id, "t2");
});

/* -------------------------------------------------------------------------- */
/* resolveRateForAmount                                                        */
/* -------------------------------------------------------------------------- */

test("a plan with no ladder is sold at its own rate", () => {
  const resolved = resolveRateForAmount(PLAN, [], decimal("25"));
  assert.equal(resolved.source, "plan");
  assert.equal(resolved.ratePercent, 8);
  assert.equal(resolved.tierId, null);
});

test("a plan whose every band is inactive falls back to its own rate", () => {
  const inactive = LADDER.map((tier) => ({ ...tier, active: false }));
  const resolved = resolveRateForAmount(PLAN, inactive, decimal("25"));
  assert.equal(resolved.source, "plan");
  assert.equal(resolved.ratePercent, 8);
});

test("a matched band's rate wins over the plan's own", () => {
  const resolved = resolveRateForAmount(PLAN, LADDER, decimal("50"));
  assert.equal(resolved.source, "tier");
  assert.equal(resolved.tierId, "t2");
  assert.equal(resolved.ratePercent, 3);
  assert.equal(resolved.minAmountUsdt, 50);
  assert.equal(resolved.maxAmountUsdt, 100);
});

test("an amount no band covers is refused, never sold at the plan rate", () => {
  // The dangerous alternative: silently falling back to 8%. An operator who
  // wrote a ladder said what each amount costs, and one they did not cover is
  // a gap somebody has to see.
  assert.throws(
    () => resolveRateForAmount(PLAN, LADDER, decimal("5")),
    (error: unknown) => error instanceof PlanTierError,
  );
});

test("the top band being open-ended means no amount above it is ever unpriced", () => {
  const resolved = resolveRateForAmount(PLAN, LADDER, decimal("99999999"));
  assert.equal(resolved.ratePercent, 5);
  assert.equal(resolved.maxAmountUsdt, null);
});

/* -------------------------------------------------------------------------- */
/* validateTierLadder                                                          */
/* -------------------------------------------------------------------------- */

test("a contiguous, non-overlapping ladder validates clean", () => {
  assert.deepEqual(validateTierLadder(LADDER), []);
});

test("an empty ladder validates clean — no ladder is a supported configuration", () => {
  assert.deepEqual(validateTierLadder([]), []);
});

test("overlapping tiers are refused", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: 10, maxAmountUsdt: 60, ratePercent: 2, active: true },
    { minAmountUsdt: 50, maxAmountUsdt: null, ratePercent: 3, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("overlaps")));
});

test("an overlap is still refused when one of the two is inactive", () => {
  // Checked as written, not as switched on: re-activating it later must not
  // be able to introduce an ambiguity the form would have caught.
  const problems = validateTierLadder([
    { minAmountUsdt: 10, maxAmountUsdt: 60, ratePercent: 2, active: false },
    { minAmountUsdt: 50, maxAmountUsdt: null, ratePercent: 3, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("overlaps")));
});

test("a gap between tiers is refused", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: 10, maxAmountUsdt: 50, ratePercent: 2, active: true },
    { minAmountUsdt: 60, maxAmountUsdt: null, ratePercent: 3, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("Nothing covers")));
});

test("duplicate lower bounds are refused", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: 10, maxAmountUsdt: 50, ratePercent: 2, active: true },
    { minAmountUsdt: 10, maxAmountUsdt: 100, ratePercent: 3, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("both start at")));
});

test("an inverted band is refused", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: 100, maxAmountUsdt: 50, ratePercent: 2, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("above the lower bound")));
});

test("a zero-width band is refused", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: 50, maxAmountUsdt: 50, ratePercent: 2, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("above the lower bound")));
});

test("a negative bound is refused", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: -10, maxAmountUsdt: 50, ratePercent: 2, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("zero or more")));
});

test("a zero or negative rate is refused", () => {
  assert.ok(
    validateTierLadder([
      { minAmountUsdt: 10, maxAmountUsdt: null, ratePercent: 0, active: true },
    ]).some((problem) => problem.includes("above zero")),
  );
  assert.ok(
    validateTierLadder([
      { minAmountUsdt: 10, maxAmountUsdt: null, ratePercent: -1, active: true },
    ]).some((problem) => problem.includes("above zero")),
  );
});

test("only the highest tier may be open-ended", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: 10, maxAmountUsdt: null, ratePercent: 2, active: true },
    { minAmountUsdt: 50, maxAmountUsdt: null, ratePercent: 3, active: true },
  ]);
  assert.ok(problems.some((problem) => problem.includes("open-ended")));
});

test("a ladder that cannot price every amount the plan accepts is refused", () => {
  const plan = { minInvestment: 10, maxInvestment: 5000, name: "Test Plan" };

  // Starts above the plan's minimum.
  assert.ok(
    validateTierLadder(
      [{ minAmountUsdt: 50, maxAmountUsdt: null, ratePercent: 3, active: true }],
      plan,
    ).some((problem) => problem.includes("could not be priced")),
  );

  // Ends below the plan's maximum.
  assert.ok(
    validateTierLadder(
      [{ minAmountUsdt: 10, maxAmountUsdt: 1000, ratePercent: 3, active: true }],
      plan,
    ).some((problem) => problem.includes("open-ended")),
  );

  // Covers the whole range.
  assert.deepEqual(
    validateTierLadder(
      [
        { minAmountUsdt: 10, maxAmountUsdt: 50, ratePercent: 2, active: true },
        { minAmountUsdt: 50, maxAmountUsdt: null, ratePercent: 3, active: true },
      ],
      plan,
    ),
    [],
  );
});

test("every problem in a ladder is reported at once, not just the first", () => {
  const problems = validateTierLadder([
    { minAmountUsdt: -5, maxAmountUsdt: 50, ratePercent: 0, active: true },
    { minAmountUsdt: 40, maxAmountUsdt: null, ratePercent: -2, active: true },
  ]);
  // negative bound, zero rate, negative rate, overlap.
  assert.ok(problems.length >= 4, `expected several problems, got ${problems.length}`);
});
