import "server-only";

import { asc, ne } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { DepositNetwork, Plan, VipLevel } from "@/types";
import type { AdminPlan } from "@/types/admin";

import { toAdminPlan, toDepositNetwork, toPlan, toVipLevel } from "./mappers";

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
  return rows.map(toPlan);
}

/** The operator's catalogue, disabled plans included. */
export async function listAdminPlans(db: Database): Promise<AdminPlan[]> {
  const rows = await db
    .select()
    .from(schema.plans)
    .orderBy(asc(schema.plans.sortOrder));
  return rows.map(toAdminPlan);
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
