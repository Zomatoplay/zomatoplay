import type { EarningsSummary, Investment } from "@/types";

/**
 * Mock investments and earnings.
 * INTEGRATION POINT: replace with the investments API.
 */

export const investments: Investment[] = [
  {
    id: "inv_1041",
    planId: "plan_balanced",
    planName: "Balanced Growth",
    amount: 2500,
    profit: 186.4,
    projectedProfit: 300,
    startDate: "2026-06-18T00:00:00.000Z",
    endDate: "2026-09-16T00:00:00.000Z",
    durationDays: 90,
    elapsedDays: 52,
    status: "active",
    rewardFrequency: "weekly",
    nextRewardDate: "2026-08-13T00:00:00.000Z",
    nextRewardAmount: 23.4,
    risk: "balanced",
  },
  {
    id: "inv_1038",
    planId: "plan_momentum",
    planName: "Momentum Plan",
    amount: 1200,
    profit: 94.8,
    projectedProfit: 312,
    startDate: "2026-05-02T00:00:00.000Z",
    endDate: "2026-10-29T00:00:00.000Z",
    durationDays: 180,
    elapsedDays: 99,
    status: "active",
    rewardFrequency: "monthly",
    nextRewardDate: "2026-09-02T00:00:00.000Z",
    nextRewardAmount: 52,
    risk: "growth",
  },
  {
    id: "inv_1035",
    planId: "plan_flexible",
    planName: "Flexible Reserve",
    amount: 200,
    profit: 4.15,
    projectedProfit: 9,
    startDate: "2026-07-21T00:00:00.000Z",
    endDate: "2026-07-21T00:00:00.000Z",
    durationDays: 0,
    elapsedDays: 19,
    status: "active",
    rewardFrequency: "daily",
    nextRewardDate: "2026-08-10T00:00:00.000Z",
    nextRewardAmount: 0.25,
    risk: "conservative",
  },
  {
    id: "inv_1022",
    planId: "plan_starter",
    planName: "Starter Plan",
    amount: 500,
    profit: 17.5,
    projectedProfit: 17.5,
    startDate: "2026-04-10T00:00:00.000Z",
    endDate: "2026-05-10T00:00:00.000Z",
    durationDays: 30,
    elapsedDays: 30,
    status: "completed",
    rewardFrequency: "daily",
    nextRewardDate: null,
    nextRewardAmount: null,
    risk: "conservative",
  },
  {
    id: "inv_1009",
    planId: "plan_balanced",
    planName: "Balanced Growth",
    amount: 800,
    profit: 96,
    projectedProfit: 96,
    startDate: "2025-12-05T00:00:00.000Z",
    endDate: "2026-03-05T00:00:00.000Z",
    durationDays: 90,
    elapsedDays: 90,
    status: "completed",
    rewardFrequency: "weekly",
    nextRewardDate: null,
    nextRewardAmount: null,
    risk: "balanced",
  },
];

export const activeInvestments = investments.filter(
  (investment) => investment.status === "active",
);

export const completedInvestments = investments.filter(
  (investment) => investment.status === "completed",
);

export function getInvestmentById(id: string): Investment | undefined {
  return investments.find((investment) => investment.id === id);
}

export const earningsSummary: EarningsSummary = {
  thisWeek: 42.18,
  thisMonth: 168.55,
  lastMonth: 151.2,
  total: 842.35,
  weekChangePercent: 8.4,
  monthChangePercent: 11.5,
  weekly: [
    { label: "Mon", value: 5.2 },
    { label: "Tue", value: 6.1 },
    { label: "Wed", value: 5.8 },
    { label: "Thu", value: 7.4 },
    { label: "Fri", value: 6.3 },
    { label: "Sat", value: 5.9 },
    { label: "Sun", value: 5.48 },
  ],
  monthly: [
    { label: "Mar", value: 96.4 },
    { label: "Apr", value: 112.8 },
    { label: "May", value: 104.2 },
    { label: "Jun", value: 138.6 },
    { label: "Jul", value: 151.2 },
    { label: "Aug", value: 168.55 },
  ],
};

/** Previous-month breakdown used in Wallet → Earnings. */
export const monthlyEarningsHistory = [
  { month: "August 2026", amount: 168.55, partial: true },
  { month: "July 2026", amount: 151.2, partial: false },
  { month: "June 2026", amount: 138.6, partial: false },
  { month: "May 2026", amount: 104.2, partial: false },
  { month: "April 2026", amount: 112.8, partial: false },
  { month: "March 2026", amount: 96.4, partial: false },
];
