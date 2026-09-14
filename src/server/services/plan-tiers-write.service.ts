import "server-only";

import { asc, eq, inArray } from "drizzle-orm";

import { applyPercent, decimal, numericValue } from "@/db/money";
import * as t from "@/db/schema";
import { getDb } from "@/db";

import {
  describeBand,
  resolveRateForAmount,
  sortTiers,
  validateTierLadder,
  type PlanRateTier,
  type PlanRateTierInput,
  type ResolvedTier,
} from "./plan-tiers";
import { mutate, newId, withReason, type Actor } from "../write";

/**
 * Writing a plan's rate ladder.
 *
 * THE WHOLE LADDER IS SAVED AT ONCE, AND THAT IS THE POINT
 * ---------------------------------------------------------
 * The rules a ladder has to satisfy — contiguous, non-overlapping, covering
 * everything the plan accepts — are properties of the *set*, not of a band. An
 * API that added, edited and removed one band at a time would have to either
 * forbid every intermediate state (so an operator could never move a boundary,
 * because widening one band overlaps its neighbour until the neighbour moves
 * too) or allow invalid ladders to exist between calls (so an allocation
 * arriving mid-edit gets priced against a half-written table). Saving the
 * ladder as a unit, in one transaction, has neither problem: what is validated
 * is exactly what is stored.
 *
 * WHAT A SAVE DOES TO ALLOCATIONS ALREADY MADE: NOTHING
 * -----------------------------------------------------
 * The same rule as `plan_rate_history` (CLAUDE.md §10b), extended to bands. An
 * allocation copied its band's id, bounds and rate onto its own row at
 * creation, and its `projected_profit` was computed from that copy. Nothing
 * here re-reads or rewrites an `investments` row, so a rate change reaches
 * only allocations created after it — and a band that is deleted takes no
 * evidence with it, because `investments.applied_tier_*` is a copy and not a
 * foreign key.
 */

export class PlanTierWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanTierWriteError";
  }
}

export interface TierDraft {
  /** Present when the operator edited an existing band; absent when adding. */
  id?: string;
  minAmountUsdt: number;
  maxAmountUsdt: number | null;
  ratePercent: number;
  active: boolean;
}

/**
 * Replaces a plan's ladder with `draft`, atomically.
 *
 * `draft` is the ladder in full: a band the operator removed is simply absent
 * from it. An empty array removes the ladder entirely, which is a supported
 * configuration — the plan goes back to being priced by its own
 * `estimated_return_percent`.
 */
export async function savePlanRateTiers(
  request: { planId: string; tiers: TierDraft[]; reason?: string },
  actor: Actor,
): Promise<{ saved: number }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const [plan] = await tx
      .select({
        id: t.plans.id,
        name: t.plans.name,
        minInvestment: t.plans.minInvestment,
        maxInvestment: t.plans.maxInvestment,
      })
      .from(t.plans)
      .where(eq(t.plans.id, request.planId))
      .limit(1)
      // Locked for the duration: two operators saving ladders for the same
      // plan at once would otherwise each validate against their own view and
      // both write, leaving whichever committed second as the whole truth
      // without ever having seen the other's bands.
      .for("update");

    if (!plan) throw new PlanTierWriteError("That plan no longer exists.");

    /*
     * Amounts and rates are validated as exact decimals before anything is
     * written, each against the scale its own column actually stores.
     *
     * `decimal()` covers the amounts: `usdt` is `numeric(20, 8)` and that is
     * the scale it enforces. It does **not** cover the rate — `percent` is
     * `numeric(8, 4)`, so an operator typing 2.123456789 would pass
     * `decimal()`, reach Postgres, and be silently rounded to 2.1235 on
     * assignment. A rate saved under somebody's name that is not the rate they
     * typed is worse than a refusal, so the scale is checked here.
     */
    const drafts = request.tiers.map((tier, index) => {
      try {
        return {
          ...tier,
          minDecimal: decimal(tier.minAmountUsdt),
          maxDecimal: tier.maxAmountUsdt === null ? null : decimal(tier.maxAmountUsdt),
          rateDecimal: percentDecimal(tier.ratePercent),
        };
      } catch (error) {
        throw new PlanTierWriteError(
          `Tier ${index + 1}: ${error instanceof Error ? error.message : "invalid number."}`,
        );
      }
    });

    /*
     * Two drafts naming the same row.
     *
     * The form cannot produce this — its rows carry distinct keys — but this
     * function is the boundary, not the form. Left unchecked, the second write
     * would overwrite the first and the ladder would silently come back one
     * band short of what was sent, which is the worst possible outcome for a
     * save that reported success.
     */
    const ids = drafts.map((tier) => tier.id).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      throw new PlanTierWriteError("Two tiers refer to the same row.");
    }

    const problems = validateTierLadder(drafts, {
      minInvestment: plan.minInvestment,
      maxInvestment: plan.maxInvestment,
      name: plan.name,
    });
    if (problems.length > 0) {
      // Every problem at once — see `validateTierLadder`. Joined rather than
      // returned as a list because the action layer surfaces one message.
      throw new PlanTierWriteError(problems.join(" "));
    }

    const before = await tx
      .select()
      .from(t.planRateTiers)
      .where(eq(t.planRateTiers.planId, plan.id))
      .orderBy(asc(t.planRateTiers.minAmountUsdt));

    /*
     * Rows the draft no longer mentions are deleted; the rest are written by
     * id. Delete-then-insert-everything would be simpler and would churn every
     * band's id on every save — which would break the one thing the ids are
     * for, letting an `investments.applied_tier_id` still point at the band
     * that priced it.
     */
    const keptIds = drafts
      .map((tier) => tier.id)
      .filter((id): id is string => typeof id === "string");
    const removed = before.filter((row) => !keptIds.includes(row.id));
    if (removed.length > 0) {
      await tx.delete(t.planRateTiers).where(
        inArray(
          t.planRateTiers.id,
          removed.map((row) => row.id),
        ),
      );
    }

    for (const tier of drafts) {
      const values = {
        planId: plan.id,
        minAmountUsdt: numericValue(tier.minDecimal),
        maxAmountUsdt: tier.maxDecimal === null ? null : numericValue(tier.maxDecimal),
        ratePercent: numericValue(tier.rateDecimal),
        active: tier.active,
        updatedAt: now,
      };

      if (tier.id && before.some((row) => row.id === tier.id)) {
        await tx
          .update(t.planRateTiers)
          .set(values)
          .where(eq(t.planRateTiers.id, tier.id));
      } else {
        await tx.insert(t.planRateTiers).values({
          id: tier.id ?? newId("ptr", now),
          createdAt: now,
          ...values,
        });
      }
    }

    audit({
      action: "plan_updated",
      target: { type: "plan", id: plan.id, label: plan.name },
      details: withReason(
        `Updated ${plan.name}'s rate tiers. Before: ${describeLadder(before)}. ` +
          `After: ${describeLadder(drafts)}. Effective for new allocations only — ` +
          `existing allocations keep the tier and rate they were sold at.`,
        request.reason,
      ),
    });

    return { saved: drafts.length };
  });
}

/**
 * A percentage at the scale the `percent` column stores — four decimal places.
 *
 * `decimal()` alone allows eight, because that is the scale of a *money*
 * column. Anything finer than four would be rounded by Postgres on assignment
 * and the operator would never be told.
 */
function percentDecimal(value: number) {
  const amount = decimal(value);
  const [, fraction = ""] = amount.split(".");
  if (fraction.length > PERCENT_SCALE) {
    throw new PlanTierWriteError(
      `a rate can carry at most ${PERCENT_SCALE} decimal places; ${value} has ${fraction.length}.`,
    );
  }
  return amount;
}

/** `numeric(8, 4)` — see `percent` in `@/db/schema/columns`. */
const PERCENT_SCALE = 4;

/** `50–100 @ 2.8%, 100+ @ 4.2%` / `none`. Audit prose. */
function describeLadder(tiers: readonly PlanRateTierInput[]): string {
  if (tiers.length === 0) return "no tiers";
  return sortTiers(tiers)
    .map(
      (tier) =>
        `${describeBand(tier)} @ ${tier.ratePercent}%${tier.active ? "" : " (inactive)"}`,
    )
    .join(", ");
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                     */
/* -------------------------------------------------------------------------- */

export interface TierPreview {
  planId: string;
  planName: string;
  amountUsdt: string;
  resolved: ResolvedTier;
  /** What an allocation of this amount would be projected to earn. */
  projectedProfitUsdt: string;
}

/**
 * "What would 75 USDT be sold at?" — answered by the same function that sells
 * it.
 *
 * The CRM's preview calls this rather than recomputing anything in the form.
 * A preview computed in the browser is a second implementation of the pricing
 * rule, and the whole value of a preview is that it tells an operator what the
 * *real* one will do.
 */
export async function previewPlanRate(
  planId: string,
  amount: string,
): Promise<TierPreview> {
  const db = getDb();

  const [plan] = await db
    .select({
      id: t.plans.id,
      name: t.plans.name,
      estimatedReturnPercent: t.plans.estimatedReturnPercent,
      minInvestment: t.plans.minInvestment,
      maxInvestment: t.plans.maxInvestment,
    })
    .from(t.plans)
    .where(eq(t.plans.id, planId))
    .limit(1);
  if (!plan) throw new PlanTierWriteError("That plan no longer exists.");

  const value = decimal(amount);

  const rows = await db
    .select()
    .from(t.planRateTiers)
    .where(eq(t.planRateTiers.planId, planId))
    .orderBy(asc(t.planRateTiers.minAmountUsdt));

  const tiers: PlanRateTier[] = rows.map((tier) => ({
    id: tier.id,
    minAmountUsdt: tier.minAmountUsdt,
    maxAmountUsdt: tier.maxAmountUsdt,
    ratePercent: tier.ratePercent,
    active: tier.active,
  }));

  const resolved = resolveRateForAmount(plan, tiers, value);

  return {
    planId: plan.id,
    planName: plan.name,
    amountUsdt: value,
    resolved,
    // `applyPercent`, the same exact-integer path `createInvestment` uses, so
    // the preview and the allocation agree to the last decimal place.
    projectedProfitUsdt: applyPercent(value, decimal(resolved.ratePercent)),
  };
}
