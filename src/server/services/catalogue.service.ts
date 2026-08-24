import "server-only";

import { plans as seedPlans } from "@/data/plans";
import { vipLevels as seedVipLevels } from "@/data/referrals";
import { depositNetworks as seedDepositNetworks } from "@/data/transactions";
import type { DepositNetwork, Plan, VipLevel } from "@/types";

import { fromDatabase } from "../database";
import {
  listDepositNetworks,
  listPublicPlans,
  listVipLevels,
} from "../repositories/catalogue.repository";

/**
 * Catalogue content for the user application.
 *
 * This is the static-feeling half of the app — plans, networks, VIP tiers — and
 * it stays server-rendered (CLAUDE.md §4.1). Reading it through a service
 * rather than importing `@/data` directly is what lets an operator's plan edit
 * reach the app once the CRM writes to the database.
 */

export async function getPlans(): Promise<Plan[]> {
  return fromDatabase(listPublicPlans, () => seedPlans);
}

export async function getPlanBySlug(slug: string): Promise<Plan | undefined> {
  const plans = await getPlans();
  return plans.find((plan) => plan.slug === slug);
}

export async function getDepositNetworks(): Promise<DepositNetwork[]> {
  return fromDatabase(listDepositNetworks, () => seedDepositNetworks);
}

export async function getVipLevels(): Promise<VipLevel[]> {
  return fromDatabase(listVipLevels, () => seedVipLevels);
}
