import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MoneyError,
  ZERO,
  add,
  applyPercent,
  compare,
  decimal,
  fromTokenUnits,
  isPositive,
  multiplyByRate,
  negate,
  subtract,
  toTokenUnits,
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

/* -------------------------------------------------------------------------- */
/* Exact addition, subtraction and rate conversion                             */
/* -------------------------------------------------------------------------- */

test("add and subtract are exact where binary floating point is not", () => {
  // The canonical float failure: 0.1 + 0.2 === 0.30000000000000004.
  assert.equal(add(decimal("0.1"), decimal("0.2")), decimal("0.3"));
  assert.equal(subtract(decimal("0.3"), decimal("0.1")), decimal("0.2"));

  // And the one that matters for a fee: 8 decimal places, no drift.
  assert.equal(
    add(decimal("0.00000001"), decimal("0.00000002")),
    decimal("0.00000003"),
  );
  assert.equal(
    subtract(decimal("100.00000000"), decimal("0.00000001")),
    decimal("99.99999999"),
  );

  // Signs, and exact zero.
  assert.equal(subtract(decimal("5"), decimal("5")), decimal("0"));
  assert.equal(subtract(decimal("1"), decimal("3")), decimal("-2"));
  assert.equal(add(decimal("-2.5"), decimal("2.5")), decimal("0"));
});

test("multiplyByRate truncates to the destination column's scale", () => {
  // 100 USDT at ₹83.25 = ₹8,325.00 exactly.
  assert.equal(
    multiplyByRate(decimal("100"), decimal("83.25"), 2),
    decimal("8325"),
  );

  // A rate that does not divide evenly is truncated, never rounded up: the
  // platform must not owe a paisa it did not compute.
  assert.equal(
    multiplyByRate(decimal("1.11111111"), decimal("83.256789"), 2),
    decimal("92.50"),
  );

  // Zero stays zero at any scale.
  assert.equal(multiplyByRate(decimal("0"), decimal("83.25"), 2), decimal("0"));

  assert.throws(() => multiplyByRate(decimal("1"), decimal("1"), -1), MoneyError);
  assert.throws(() => multiplyByRate(decimal("1"), decimal("1"), 9), MoneyError);
});

test("a withdrawal quote is exact end to end", () => {
  /*
   * The real shape of the quote in `wallet/withdraw/actions.ts`, with the
   * awkward numbers that used to drift: a 1% fee on an amount whose 1% is not
   * exactly representable, plus a flat fee, converted at a six-decimal rate.
   */
  const amount = decimal("123.45678901");
  const flatFee = decimal("1");
  const percentFee = applyPercent(amount, decimal("1"));
  const totalFee = add(flatFee, percentFee);
  const net = subtract(amount, totalFee);

  assert.equal(percentFee, decimal("1.23456789"));
  assert.equal(totalFee, decimal("2.23456789"));
  assert.equal(net, decimal("121.22222112"));

  // net + totalFee must return exactly the amount — the invariant a customer
  // would check by hand, and the one float arithmetic breaks.
  assert.equal(add(net, totalFee), amount);

  const inr = multiplyByRate(net, decimal("83.25"), 2);
  assert.equal(compare(inr, decimal("0")), 1, "a positive net pays a positive amount");
});
