import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_PLATFORM_FINANCE,
  financeSettingsRefusal,
  isValidFlatFee,
  isValidPercentFee,
  isValidRate,
  resolvePlatformFinance,
} from "./platform-finance";

describe("the launch values", () => {
  test("deposit rate, withdrawal rate and fee start at the configured figures", () => {
    assert.equal(DEFAULT_PLATFORM_FINANCE.depositRate, 100.4);
    assert.equal(DEFAULT_PLATFORM_FINANCE.withdrawalRate, 100.4);
    assert.equal(DEFAULT_PLATFORM_FINANCE.flatFeeUsdt, 1.55);
    assert.equal(DEFAULT_PLATFORM_FINANCE.percentFee, 0);
  });
});

describe("resolving the stored settings", () => {
  test("uses what an administrator saved", () => {
    const finance = resolvePlatformFinance({
      currency: { displayRate: 101.25, payoutRate: 99.9, rateLabel: "Set by us" },
      withdrawals: { flatFeeUsdt: 2, percentFee: 0.5, minimumUsdt: 30 },
    });
    assert.equal(finance.depositRate, 101.25);
    assert.equal(finance.withdrawalRate, 99.9);
    assert.equal(finance.flatFeeUsdt, 2);
    assert.equal(finance.percentFee, 0.5);
    assert.equal(finance.minimumWithdrawalUsdt, 30);
    assert.equal(finance.rateLabel, "Set by us");
  });

  test("anything missing or unusable falls back to the initial value, never to zero", () => {
    for (const stored of [
      null,
      undefined,
      {},
      { currency: { displayRate: 0, payoutRate: -5 }, withdrawals: { flatFeeUsdt: -1, percentFee: 99 } },
      { currency: { displayRate: "100", payoutRate: Number.NaN }, withdrawals: { flatFeeUsdt: Infinity } },
      { currency: { displayRate: 100.123, payoutRate: 1e9 } },
    ]) {
      const finance = resolvePlatformFinance(stored);
      assert.equal(finance.depositRate, DEFAULT_PLATFORM_FINANCE.depositRate);
      assert.equal(finance.withdrawalRate, DEFAULT_PLATFORM_FINANCE.withdrawalRate);
      assert.equal(finance.flatFeeUsdt, DEFAULT_PLATFORM_FINANCE.flatFeeUsdt);
    }
  });

  test("a zero fee is a valid choice, a zero rate is not", () => {
    assert.equal(isValidFlatFee(0), true);
    assert.equal(isValidPercentFee(0), true);
    assert.equal(isValidRate(0), false);
  });
});

describe("what an administrator may save", () => {
  const ok = { displayRate: 100.4, payoutRate: 100.4, flatFeeUsdt: 1.55, percentFee: 0 };

  test("the launch values are accepted", () => {
    assert.equal(financeSettingsRefusal(ok), null);
  });

  test("refuses rates that are not a positive number with at most two decimals", () => {
    for (const bad of [0, -1, 100.123, Number.NaN, "100", null, 10_001]) {
      assert.notEqual(financeSettingsRefusal({ ...ok, displayRate: bad }), null, `display ${String(bad)}`);
      assert.notEqual(financeSettingsRefusal({ ...ok, payoutRate: bad }), null, `payout ${String(bad)}`);
    }
  });

  test("refuses a negative, absurd or non-numeric fee", () => {
    for (const bad of [-0.01, 1001, Number.NaN, "1.55", undefined]) {
      assert.notEqual(financeSettingsRefusal({ ...ok, flatFeeUsdt: bad }), null, String(bad));
    }
    assert.notEqual(financeSettingsRefusal({ ...ok, percentFee: 21 }), null);
    assert.notEqual(financeSettingsRefusal({ ...ok, percentFee: -1 }), null);
  });
});
