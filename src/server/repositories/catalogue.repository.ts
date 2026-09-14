import "server-only";

import { asc, eq, inArray, ne } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { DepositNetwork, Plan, VipLevel } from "@/types";
import type { AdminPlan } from "@/types/admin";

import { toAdminPlan, toDepositNetwork, toPlan, toVipLevel } from "./mappers";

type PlanRateTierRow = typeof schema.planRateTiers.$inferSelect;

/**
 * Catalogue content: plans, deposit networks and VIP levels.
 *
 * All three are configuration a real deployment edits rather than deploys, and
 * both applications read the same rows — the CRM must never be able to show a
 * commission rate the user was not promised.
 */

/**
 * The public catalogue.
 *
 * `disabled` plans are excluded here rather than mapped to a status: a disabled
 * plan is withdrawn from the app entirely, which is a different thing from a
 * plan that is visible but closed to new money.
 */
export async function listPublicPlans(db: Database): Promise<Plan[]> {
  const rows = await db
    .select()
    .from(schema.plans)
    .where(ne(schema.plans.status, "disabled"))
    .orderBy(asc(schema.plans.sortOrder));
  const tiers = await tiersByPlan(db, rows.map((row) => row.id));
  return rows.map((row) => toPlan(row, tiers.get(row.id) ?? []));
}

/**
 * Every plan's rate ladder, in one query, grouped by plan.
 *
 * One statement for the whole catalogue rather than one per plan: a round trip
 * to this database costs ~200 ms warm (CLAUDE.md §16.1a), so five plans read
 * individually would be a second of latency added to `/plans` for data that
 * fits in a single `IN`. Ordered by lower bound, which is the ladder's only
 * meaningful order, so nothing downstream has to sort to render it.
 */
async function tiersByPlan(
  db: Database,
  planIds: string[],
): Promise<Map<string, PlanRateTierRow[]>> {
  const grouped = new Map<string, PlanRateTierRow[]>();
  if (planIds.length === 0) return grouped;

  const rows = await db
    .select()
    .from(schema.planRateTiers)
    .where(inArray(schema.planRateTiers.planId, planIds))
    .orderBy(asc(schema.planRateTiers.minAmountUsdt));

  for (const row of rows) {
    const existing = grouped.get(row.planId);
    if (existing) existing.push(row);
    else grouped.set(row.planId, [row]);
  }
  return grouped;
}

/** The ladder for one plan, lowest band first. Used by the CRM's editor. */
export async function listPlanRateTiers(
  db: Database,
  planId: string,
): Promise<PlanRateTierRow[]> {
  return db
    .select()
    .from(schema.planRateTiers)
    .where(eq(schema.planRateTiers.planId, planId))
    .orderBy(asc(schema.planRateTiers.minAmountUsdt));
}

/** The operator's catalogue, disabled plans included. */
export async function listAdminPlans(db: Database): Promise<AdminPlan[]> {
  const rows = await db
    .select()
    .from(schema.plans)
    .orderBy(asc(schema.plans.sortOrder));
  const tiers = await tiersByPlan(db, rows.map((row) => row.id));
  return rows.map((row) => toAdminPlan(row, tiers.get(row.id) ?? []));
}

export async function listDepositNetworks(
  db: Database,
): Promise<DepositNetwork[]> {
  const rows = await db
    .select()
    .from(schema.depositNetworks)
    .orderBy(asc(schema.depositNetworks.sortOrder));
  return rows.map(toDepositNetwork);
}

export async function listVipLevels(db: Database): Promise<VipLevel[]> {
  const rows = await db
    .select()
    .from(schema.vipLevels)
    .orderBy(asc(schema.vipLevels.sortOrder));
  return rows.map(toVipLevel);
}
