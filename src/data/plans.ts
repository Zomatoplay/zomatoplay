import type { Plan, RiskLevel } from "@/types";

/**
 * Mock investment plans.
 *
 * All return figures are illustrative projections for the prototype and are
 * always presented in the UI as "estimated" / "projected", never guaranteed.
 *
 * INTEGRATION POINT: replace with a products API / CMS read.
 */

export const plans: Plan[] = [
  {
    id: "plan_starter",
    slug: "starter",
    name: "Starter Plan",
    tagline: "A low-commitment way to begin",
    description:
      "A short-term, conservative allocation designed for first-time investors who want to understand how the platform works before committing more.",
    howItWorks: [
      "You allocate USDT from your available balance into the plan.",
      "The allocation is locked for the 30-day term.",
      "Estimated rewards accrue daily and are shown on your investment card.",
      "At maturity your principal and accrued rewards return to your available balance.",
    ],
    minInvestment: 50,
    maxInvestment: 1000,
    durationDays: 30,
    estimatedReturnPercent: 3.5,
    estimatedReturnRange: [2.8, 4.2],
    rewardFrequency: "daily",
    risk: "conservative",
    status: "open",
    highlights: [
      { label: "Term", value: "30 days" },
      { label: "Rewards", value: "Daily" },
      { label: "From", value: "50 USDT" },
    ],
    conditions: [
      "Minimum allocation 50 USDT, maximum 1,000 USDT per investment.",
      "Principal is locked for the full 30-day term.",
      "Rewards accrue daily and settle to your available balance at maturity.",
      "KYC verification is required before an investment can be created.",
    ],
    riskNotes: [
      "Projected returns are estimates based on historical strategy performance and are not guaranteed.",
      "The value of digital assets can fall as well as rise.",
      "Returns may be lower than projected, and in adverse conditions capital may be at risk.",
    ],
    earlyExit: "Early exit available after day 7 with forfeiture of accrued rewards.",
  },
  {
    id: "plan_balanced",
    slug: "balanced-growth",
    name: "Balanced Growth",
    tagline: "Our most popular allocation",
    description:
      "A diversified 90-day allocation balancing steadier yield strategies with a measured growth component. Suited to investors comfortable with a medium term.",
    howItWorks: [
      "You allocate USDT from your available balance into the plan.",
      "Capital is spread across a diversified basket of yield strategies.",
      "Estimated rewards are credited weekly and visible in your wallet.",
      "At maturity your principal returns to your available balance.",
    ],
    minInvestment: 250,
    maxInvestment: 10000,
    durationDays: 90,
    estimatedReturnPercent: 12,
    estimatedReturnRange: [9.5, 14.5],
    rewardFrequency: "weekly",
    risk: "balanced",
    status: "open",
    popular: true,
    highlights: [
      { label: "Term", value: "90 days" },
      { label: "Rewards", value: "Weekly" },
      { label: "From", value: "250 USDT" },
    ],
    conditions: [
      "Minimum allocation 250 USDT, maximum 10,000 USDT per investment.",
      "Principal is locked for the full 90-day term.",
      "Rewards are credited weekly to your available balance.",
      "You may hold multiple Balanced Growth investments simultaneously.",
      "KYC verification is required before an investment can be created.",
    ],
    riskNotes: [
      "Projected returns are estimates and are not guaranteed.",
      "This plan carries a moderate risk profile; returns will vary with market conditions.",
      "Capital is at risk. Only allocate what you can afford to leave invested for the full term.",
    ],
    earlyExit: "Early exit available after day 30 with a 2% exit fee on principal.",
  },
  {
    id: "plan_momentum",
    slug: "momentum",
    name: "Momentum Plan",
    tagline: "Higher projected reward, higher variance",
    description:
      "A 180-day growth allocation with a higher projected return and a correspondingly wider range of outcomes. Intended for experienced investors.",
    howItWorks: [
      "You allocate USDT from your available balance into the plan.",
      "Capital is deployed into higher-variance growth strategies.",
      "Estimated rewards are credited monthly.",
      "At maturity your principal returns to your available balance.",
    ],
    minInvestment: 1000,
    maxInvestment: 50000,
    durationDays: 180,
    estimatedReturnPercent: 26,
    estimatedReturnRange: [16, 34],
    rewardFrequency: "monthly",
    risk: "growth",
    status: "limited",
    capacityFilledPercent: 78,
    highlights: [
      { label: "Term", value: "180 days" },
      { label: "Rewards", value: "Monthly" },
      { label: "From", value: "1,000 USDT" },
    ],
    conditions: [
      "Minimum allocation 1,000 USDT, maximum 50,000 USDT per investment.",
      "Principal is locked for the full 180-day term.",
      "Allocation capacity is limited and may close without notice.",
      "KYC verification is required before an investment can be created.",
    ],
    riskNotes: [
      "This is the highest-variance plan on the platform.",
      "Projected returns are estimates only; actual outcomes may be materially lower.",
      "Capital is at risk and losses are possible. Do not allocate funds you may need during the term.",
    ],
    earlyExit: "No early exit. Principal is locked until maturity.",
  },
  {
    id: "plan_flexible",
    slug: "flexible-reserve",
    name: "Flexible Reserve",
    tagline: "Withdraw any time",
    description:
      "An open-ended allocation with no lock-in. Lower projected rewards in exchange for the ability to move funds back to your available balance whenever you want.",
    howItWorks: [
      "You allocate USDT from your available balance into the reserve.",
      "There is no fixed term — funds stay allocated until you withdraw them.",
      "Estimated rewards accrue daily on the allocated balance.",
      "You can return funds to your available balance at any time.",
    ],
    minInvestment: 25,
    maxInvestment: 25000,
    durationDays: 0,
    estimatedReturnPercent: 4.5,
    estimatedReturnRange: [3.5, 5.5],
    rewardFrequency: "daily",
    risk: "conservative",
    status: "open",
    highlights: [
      { label: "Term", value: "No lock-in" },
      { label: "Rewards", value: "Daily" },
      { label: "From", value: "25 USDT" },
    ],
    conditions: [
      "Minimum allocation 25 USDT.",
      "No lock-in period — funds can be returned to your available balance at any time.",
      "Rewards accrue daily and are credited to your available balance.",
      "Projected annualised rate is variable and may change.",
    ],
    riskNotes: [
      "The projected rate is variable and can change without notice.",
      "Although there is no lock-in, capital is still at risk.",
    ],
    earlyExit: "No lock-in. Funds can be returned to your available balance instantly.",
  },
  {
    id: "plan_institutional",
    slug: "institutional",
    name: "Institutional Plan",
    tagline: "Currently closed to new allocations",
    description:
      "A 365-day allocation for large-ticket investors. This plan is closed while the current cohort runs; new allocations reopen at the next cycle.",
    howItWorks: [
      "Allocations open in cohorts a few times each year.",
      "Capital is committed for a full 365-day term.",
      "Estimated rewards are settled on maturity.",
    ],
    minInvestment: 25000,
    maxInvestment: 500000,
    durationDays: 365,
    estimatedReturnPercent: 38,
    estimatedReturnRange: [24, 48],
    rewardFrequency: "on_maturity",
    risk: "growth",
    status: "closed",
    highlights: [
      { label: "Term", value: "365 days" },
      { label: "Rewards", value: "On maturity" },
      { label: "From", value: "25,000 USDT" },
    ],
    conditions: [
      "Minimum allocation 25,000 USDT.",
      "Allocations open only during a cohort window.",
      "Principal and rewards settle together at maturity.",
      "Enhanced verification is required in addition to standard KYC.",
    ],
    riskNotes: [
      "Long lock-in with no early exit; funds are inaccessible for the full term.",
      "Projected returns are estimates only and carry significant variance.",
      "Capital is at risk.",
    ],
    earlyExit: "No early exit under any circumstances.",
  },
];

export function getPlanBySlug(slug: string): Plan | undefined {
  return plans.find((plan) => plan.slug === slug);
}

export function getPlanById(id: string): Plan | undefined {
  return plans.find((plan) => plan.id === id);
}

export const riskLabels: Record<RiskLevel, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  growth: "Growth",
};

export const riskDescriptions: Record<RiskLevel, string> = {
  conservative: "Lower projected returns, narrower range of outcomes.",
  balanced: "Moderate projected returns with moderate variance.",
  growth: "Higher projected returns with a materially wider range of outcomes.",
};

export const rewardFrequencyLabels = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  on_maturity: "On maturity",
} as const;
