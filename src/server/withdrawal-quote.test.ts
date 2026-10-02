import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decimal } from "@/db/money";
import { DEFAULT_PLATFORM_FINANCE } from "@/lib/platform-finance";
import { displayWithdrawalQuote } from "@/lib/withdrawal-quote";

import { exactWithdrawalQuote } from "./withdrawal-quote";

const LAUNCH = DEFAULT_PLATFORM_FINANCE;

describe("the launch withdrawal terms: ₹100.40 per USDT, 1.55 USDT fee", () => {
  test("100 USDT pays out exactly ₹9,884.38", () => {
    const quote = exactWithdrawalQuote(decimal("100"), LAUNCH);
    assert.ok(quote);
    assert.equal(quote.flatFeeUsdt, "1.55");
    assert.equal(quote.percentFeeUsdt, "0");
    assert.equal(quote.totalFeeUsdt, "1.55");
    assert.equal(quote.netUsdt, "98.45");
    assert.equal(quote.payoutRate, "100.4");
    assert.equal(quote.netInr, "9884.38"); // 98.45 × 100.40
  });

  test("the smallest allowed withdrawal still leaves a positive payout", () => {
    const quote = exactWithdrawalQuote(decimal("20"), LAUNCH);
    assert.ok(quote);
    assert.equal(quote.netUsdt, "18.45");
    assert.equal(quote.netInr, "1852.38");
  });
});

describe("fees larger than the amount", () => {
  test("are refused rather than clamped to a zero payout", () => {
    assert.equal(exactWithdrawalQuote(decimal("1.55"), LAUNCH), null);
    assert.equal(exactWithdrawalQuote(decimal("1"), LAUNCH), null);
  });
});

describe("changed settings", () => {
  test("a different rate, flat fee and percentage are all applied", () => {
    const quote = exactWithdrawalQuote(decimal("200"), {
      withdrawalRate: 99.75,
      flatFeeUsdt: 2.25,
      percentFee: 0.5,
    });
    assert.ok(quote);
    assert.equal(quote.percentFeeUsdt, "1");
    assert.equal(quote.totalFeeUsdt, "3.25");
    assert.equal(quote.netUsdt, "196.75");
    assert.equal(quote.netInr, "19625.81"); // 196.75 × 99.75 = 19625.8125
  });
});

describe("what the screen shows is what the server stores", () => {
  test("the displayed payout equals the exact one to the paisa, across amounts", () => {
    for (const amount of ["20", "25.5", "49.99", "100", "333.33", "1000", "12345.67"]) {
      const exact = exactWithdrawalQuote(decimal(amount), LAUNCH);
      assert.ok(exact, amount);
      const shown = displayWithdrawalQuote(Number(amount), LAUNCH);
      assert.equal(shown.netInr.toFixed(2), exact.netInr, amount);
      assert.equal(shown.totalFeeUsdt.toFixed(2), Number(exact.totalFeeUsdt).toFixed(2), amount);
    }
  });
});
