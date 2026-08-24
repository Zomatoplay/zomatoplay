import assert from "node:assert/strict";
import { test } from "node:test";

import {
  compare,
  decimal,
  fromTokenUnits,
  isPositive,
  MoneyError,
  negate,
  toTokenUnits,
  ZERO,
} from "./money";

/**
 * Money, without floating point.
 *
 * These are the arithmetic guarantees the write layer is built on. If any of
 * them regresses, balances drift by amounts too small to notice until they are
 * not.
 */

test("rejects anything that is not an exact decimal", () => {
  for (const bad of ["", " ", "abc", "1e5", "1,000", "NaN", "Infinity", "1.2.3", "+5", "0x10"]) {
    assert.throws(() => decimal(bad), MoneyError, `should reject ${JSON.stringify(bad)}`);
  }
});

test("normalises so equal amounts compare equal", () => {
  assert.equal(decimal("1.50"), decimal("1.5"));
  assert.equal(decimal("-0"), ZERO);
  assert.equal(decimal("0.00000000"), ZERO);
  assert.equal(compare(decimal("1.50"), decimal("1.5")), 0);
});

test("refuses more precision than the schema stores", () => {
  assert.doesNotThrow(() => decimal("0.12345678"));
  assert.throws(() => decimal("0.123456789"), MoneyError);
});

test("refuses a number that is not exactly representable", () => {
  // The canonical example: this is 0.30000000000000004 in float64, and
  // accepting it would write a balance nobody asked for.
  assert.throws(() => decimal(0.1 + 0.2), MoneyError);
  assert.equal(decimal(1250), "1250");
  assert.equal(decimal(0.5), "0.5");
});

test("converts token units exactly, including past MAX_SAFE_INTEGER", () => {
  // TRC-20 USDT has six decimals.
  assert.equal(fromTokenUnits("1000000", 6), "1");
  assert.equal(fromTokenUnits("1500000", 6), "1.5");
  assert.equal(fromTokenUnits("1", 6), "0.000001");
  assert.equal(fromTokenUnits("0", 6), "0");

  // 9007199254740993 is the first integer float64 cannot represent. Going
  // through `Number()` here would round it, and the deposit would be wrong.
  assert.equal(fromTokenUnits("9007199254740993", 0), "9007199254740993");
});

test("rejects malformed token amounts rather than coercing them", () => {
  for (const bad of ["", "-1", "1.5", "abc", "1e6"]) {
    assert.throws(() => fromTokenUnits(bad, 6), MoneyError);
  }
  assert.throws(() => fromTokenUnits("100", -1), MoneyError);
  assert.throws(() => fromTokenUnits("100", 99), MoneyError);
});

test("round-trips through token units", () => {
  for (const amount of ["1", "1.5", "0.000001", "1250.123456"]) {
    const units = toTokenUnits(decimal(amount), 6);
    assert.equal(fromTokenUnits(units, 6), decimal(amount));
  }
});

test("refuses to silently truncate when converting to token units", () => {
  // Six-decimal token, seven-decimal amount: the last digit would vanish.
  assert.throws(() => toTokenUnits(decimal("0.0000001"), 6), MoneyError);
});

test("compares exactly where float would not", () => {
  assert.equal(compare(decimal("0.1"), decimal("0.2")), -1);
  assert.equal(compare(decimal("1000000.00000001"), decimal("1000000")), 1);
  assert.equal(compare(decimal("-5"), decimal("5")), -1);
  assert.ok(isPositive(decimal("0.00000001")));
  assert.ok(!isPositive(ZERO));
});

test("negates without producing -0", () => {
  assert.equal(negate(decimal("5")), "-5");
  assert.equal(negate(decimal("-5")), "5");
  assert.equal(negate(ZERO), "0");
});

test("drops trailing zeros before judging precision", () => {
  // An 18-decimal token reporting 2.5 is representable; the padding is not
  // precision. This is the case that made `fromTokenUnits` reject a valid
  // amount for having eighteen decimal places.
  assert.equal(fromTokenUnits("2500000000000000000", 18), "2.5");
  assert.equal(fromTokenUnits("1000000000000000000", 18), "1");

  // Genuine precision beyond what the schema stores is still refused, rather
  // than quietly rounded into the ledger.
  assert.throws(() => fromTokenUnits("2500000000000000001", 18), MoneyError);
});
