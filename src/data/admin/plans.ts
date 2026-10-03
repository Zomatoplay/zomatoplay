import { plans } from "@/data/plans";
import type { AdminPlan, AdminPlanStatus } from "@/types/admin";

/**
 * Admin projection of the plan catalogue.
 *
 * Derived from the public catalogue in `@/data/plans` so the two never drift:
 * an operator editing a plan here is editing the same product the user browses.
 * The admin record adds the operational figures (`stats`) a products service
 * would compute, plus a `disabled` status the public catalogue has no concept
 * of — a disabled plan is withdrawn from the app entirely rather than shown as
 * closed.
 *
 * INTEGRATION POINT: replace with `GET /admin/plans`; the edit form becomes
 * `PATCH /admin/plans/:id`.
 */

/** Live figures per plan — sourced from the allocation ledger in a real system. */
const planStats: Record<
  string,
  { activeInvestments: number; totalAllocated: number; totalProfitPaid: number }
> = {
  plan_starter: { activeInvestments: 46, totalAllocated: 31400, totalProfitPaid: 942.8 },
  plan_balanced: {
    activeInvestments: 118,
    totalAllocated: 246500,
    totalProfitPaid: 18420.6,
  },
  plan_momentum: {
    activeInvestments: 34,
    totalAllocated: 312800,
    totalProfitPaid: 24106.4,
  },
  plan_flexible: { activeInvestments: 62, totalAllocated: 48900, totalProfitPaid: 1284.5 },
  plan_institutional: {
    activeInvestments: 4,
    totalAllocated: 180000,
    totalProfitPaid: 0,
  },
};

const planUpdatedAt: Record<string, string> = {
  plan_starter: "2026-06-02T10:14:00.000Z",
  plan_balanced: "2026-07-28T09:41:00.000Z",
  plan_momentum: "2026-08-01T16:22:00.000Z",
  plan_flexible: "2026-05-19T13:08:00.000Z",
  plan_institutional: "2026-03-11T11:35:00.000Z",
};

export const adminPlans: AdminPlan[] = plans.map((plan) => ({
  id: plan.id,
  slug: plan.slug,
  name: plan.name,
  tagline: plan.tagline,
  description: plan.description,
  minInvestment: plan.minInvestment,
  maxInvestment: plan.maxInvestment,
  durationDays: plan.durationDays,
  estimatedReturnPercent: plan.estimatedReturnPercent,
  estimatedReturnRange: plan.estimatedReturnRange,
  // The same bands the public catalogue carries — one ladder, two projections
  // of it, so the CRM can never show a rate a customer was not offered.
  rateTiers: plan.rateTiers,
  durationRates: plan.durationRates,
  rewardFrequency: plan.rewardFrequency,
  risk: plan.risk,
  status: plan.status as AdminPlanStatus,
  capacityFilledPercent: plan.capacityFilledPercent,
  stats: planStats[plan.id] ?? {
    activeInvestments: 0,
    totalAllocated: 0,
    totalProfitPaid: 0,
  },
  updatedAt: planUpdatedAt[plan.id] ?? "2026-01-01T00:00:00.000Z",
}));

export const planStatusLabels: Record<AdminPlanStatus, string> = {
  open: "Open",
  limited: "Limited capacity",
  closed: "Closed",
  disabled: "Disabled",
};

export const planStatusDescriptions: Record<AdminPlanStatus, string> = {
  open: "Accepting new allocations.",
  limited: "Accepting allocations up to the remaining capacity.",
  closed: "Visible in the app but not accepting new allocations.",
  disabled: "Hidden from the app entirely. Existing allocations continue to run.",
};

export function getAdminPlanById(id: string): AdminPlan | undefined {
  return adminPlans.find((p) => p.id === id);
}
