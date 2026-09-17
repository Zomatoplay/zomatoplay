import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { generateMemberId } from "./account";

/**
 * The member-id generator, with no database.
 *
 * This is where the id's *shape* is asserted. It used to be asserted over the
 * `users` table, and that fails for a reason worth remembering: the
 * integration suites share one live database, and several of them insert
 * accounts directly with ids in their own shape (`NT-M…`, `NT-R…`, `NT-D…`).
 * A test reading every row is therefore reading other files' scratch data, and
 * asserting on it is CLAUDE.md §16.7's mistake — a fact about the physical
 * table rather than the property the test owns. The table owes uniqueness,
 * enforced by its index and checked in `auth-and-kyc.integration.test.ts`; the
 * generator owes everything else, which is what this file checks.
 */
describe("member ids", () => {
  test("are NT- and exactly seven digits", () => {
    for (let i = 0; i < 500; i++) {
      assert.match(generateMemberId(), /^NT-\d{7}$/);
    }
  });

  test("do not come from the clock", () => {
    /*
     * The defect this replaced produced the same id for every call within a
     * millisecond, and repeated the whole space every 2h46m. A clock-derived
     * generator therefore shows up as a burst of identical — or tightly
     * ordered — values. Random ones collide at roughly the birthday rate over
     * ten million, which across 2,000 draws is a fraction of a percent.
     */
    const draws = Array.from({ length: 2000 }, () => generateMemberId());
    const distinct = new Set(draws).size;
    assert.ok(
      distinct >= 1990,
      `expected near-distinct ids from a random source, got ${distinct}/2000`,
    );

    // A clock-derived sequence is monotonic. A random one is not, and the
    // chance of 2,000 random draws arriving sorted is nil.
    const sorted = [...draws].sort();
    assert.notDeepEqual(draws, sorted);
  });

  test("spread across the digit space", () => {
    // Every leading digit should appear over enough draws. A generator pinned
    // to a timestamp prefix would fail this even while looking random.
    const leading = new Set(
      Array.from({ length: 2000 }, () => generateMemberId()[3]),
    );
    assert.equal(leading.size, 10);
  });
});
