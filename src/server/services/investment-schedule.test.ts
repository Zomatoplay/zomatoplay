import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { add, decimal, ZERO, type Decimal } from "@/db/money";

import {
  DURATION_SCHEDULE_VERSION,
  earningPeriodsFor,
  rewardScheduleFor,
  SELECTABLE_DURATIONS,
  weeklyPeriodDays,
} from "./investment-schedule";

const DAY = 24 * 60 * 60 * 1000;
const START = new Date("2026-10-01T00:00:00.000Z");

function allocation(durationDays: number, profit: string, scheduleVersion?: number) {
  return {
    startedAt: START,
    maturesAt: new Date(START.getTime() + durationDays * DAY),
    durationDays,
    rewardFrequency: "weekly" as const,
    projectedProfit: decimal(profit),
    scheduleVersion,
  };
}

const sum = (amounts: Decimal[]) => amounts.reduce((total, a) => add(total, a), ZERO);

describe("selectable-duration schedule (version 2)", () => {
  test("period lengths: whole weeks, then the remaining days — never rounded", () => {
    assert.deepEqual(weeklyPeriodDays(7), [7]);
    assert.deepEqual(weeklyPeriodDays(15), [7, 7, 1]);
    assert.deepEqual(weeklyPeriodDays(30), [7, 7, 7, 7, 2]);
    assert.deepEqual(weeklyPeriodDays(60), [7, 7, 7, 7, 7, 7, 7, 7, 4]);
    assert.deepEqual(weeklyPeriodDays(90), [...Array(12).fill(7), 6]);
    for (const days of SELECTABLE_DURATIONS) {
      assert.equal(weeklyPeriodDays(days).reduce((a, b) => a + b, 0), days);
    }
  });

  test("15 days pays 7/15, 7/15 and 1/15 of the total, the last at maturity", () => {
    const periods = earningPeriodsFor(allocation(15, "15", DURATION_SCHEDULE_VERSION));
    assert.deepEqual(
      periods.map((p) => p.amount),
      ["7", "7", "1"],
    );
    assert.deepEqual(
      periods.map((p) => p.dueAt.toISOString()),
      ["2026-10-08T00:00:00.000Z", "2026-10-15T00:00:00.000Z", "2026-10-16T00:00:00.000Z"],
    );
    assert.deepEqual(periods.map((p) => p.periodKey), ["p1", "p2", "p3"]);
  });

  test("every duration: shares sum exactly to the total and nothing is due after maturity", () => {
    for (const days of SELECTABLE_DURATIONS) {
      const a = allocation(days, "123.45678901", DURATION_SCHEDULE_VERSION);
      const periods = earningPeriodsFor(a);
      assert.equal(sum(periods.map((p) => p.amount)), "123.45678901", `${days} days`);
      assert.equal(periods.at(-1)?.dueAt.getTime(), a.maturesAt.getTime());
      assert.ok(periods.every((p) => p.dueAt <= a.maturesAt));
      assert.equal(new Set(periods.map((p) => p.periodKey)).size, periods.length);
    }
  });

  test("the forecast stops at maturity", () => {
    const a = allocation(15, "15", DURATION_SCHEDULE_VERSION);
    const next = rewardScheduleFor({ ...a, earningsCreditedPeriods: 2 }, new Date(START.getTime() + 14.5 * DAY));
    assert.equal(next.nextRewardAmount, 1);
    const after = rewardScheduleFor({ ...a, earningsCreditedPeriods: 3 }, a.maturesAt);
    assert.equal(after.nextRewardAt, null);
  });
});

describe("allocations made before durations keep the original rule", () => {
  test("version 1 (and no version) still split evenly across ceil(term ÷ 7)", () => {
    for (const version of [undefined, 1]) {
      const periods = earningPeriodsFor(allocation(15, "15", version));
      assert.deepEqual(periods.map((p) => p.amount), ["5", "5", "5"]);
    }
  });
});
