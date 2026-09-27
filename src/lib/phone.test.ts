import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  formatIndianMobile,
  isNormalizedIndianMobile,
  maskIndianMobile,
  normalizeIndianMobile,
} from "./phone";

/**
 * The phone number is an identity since phone sign-in: two spellings of one
 * number must normalise to one value, and nothing that is not an Indian mobile
 * number may normalise to anything.
 */
describe("normalizeIndianMobile", () => {
  test("every common spelling of one number is one value", () => {
    const expected = "+919876543210";
    for (const input of [
      "9876543210",
      "+91 98765 43210",
      "+91-98765-43210",
      "919876543210",
      "09876543210",
      " (98765) 43210 ",
      "+919876543210",
    ]) {
      assert.equal(normalizeIndianMobile(input), expected, input);
    }
  });

  test("refuses what is not an Indian mobile number", () => {
    for (const input of [
      "",
      "12345",
      "5876543210", // mobile series starts 6–9
      "98765432101", // eleven digits without a trunk zero
      "+1 9876543210", // another country
      "+4498765432",
      "98765abcde",
      "+91 98765 4321", // nine digits
      "0091 9876543210",
    ]) {
      assert.equal(normalizeIndianMobile(input), null, input);
    }
  });

  test("the normal form is recognised exactly", () => {
    assert.equal(isNormalizedIndianMobile("+919876543210"), true);
    assert.equal(isNormalizedIndianMobile("9876543210"), false);
    assert.equal(isNormalizedIndianMobile("+91 98765 43210"), false);
    assert.equal(isNormalizedIndianMobile(null), false);
  });

  test("masking hides the middle and never throws on bad input", () => {
    assert.equal(maskIndianMobile("+919876543210"), "+91 98XXX XX210");
    assert.equal(maskIndianMobile("nonsense"), "+91 XXXXX XXXXX");
    assert.equal(formatIndianMobile("+919876543210"), "+91 98765 43210");
  });
});
