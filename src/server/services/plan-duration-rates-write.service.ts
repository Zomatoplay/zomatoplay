import "server-only";

import { eq } from "drizzle-orm";

import { decimal, numericValue } from "@/db/money";
import * as t from "@/db/schema";
import {
  durationRateRefusal,
  PLAN_DURATIONS,
  type DurationRateDraft,
} from "@/lib/plan-durations";

import { mutate, newId, withReason, type Actor } from "../write";

/**
 * Saving a plan's per-duration rates (7/15/30/60/90 days) as one set.
 *
 * Every rate is typed by an operator; a blank one means the duration is not
 * offered. A row that is blanked is deactivated rather than deleted, so an
 * allocation's `applied_duration_rate_id` keeps pointing at it. Like the tier
 * ladder (§10c), nothing here touches an existing allocation: each one copied
 * its term and rate onto its own row when it was created.
 */
function refuse(message: string): never {
  throw Object.assign(new Error(message), { name: "AdminValidationError" });
}

export async function savePlanDurationRates(
  request: { planId: string; rates: DurationRateDraft[]; reason?: string },
  actor: Actor,
): Promise<{ offered: number }> {
  const byDuration = new Map<number, string>();
  for (const draft of request.rates) {
    if (!PLAN_DURATIONS.includes(draft.durationDays as (typeof PLAN_DURATIONS)[number])) {
      refuse(`${draft.durationDays} days is not a selectable duration.`);
    }
    if (byDuration.has(draft.durationDays)) refuse("Each duration can appear once.");
    const problem = durationRateRefusal(String(draft.ratePercent ?? ""));
    if (problem) refuse(`${draft.durationDays} days: ${problem}`);
    byDuration.set(draft.durationDays, String(draft.ratePercent ?? "").trim());
  }

  return mutate(actor, async ({ tx, now, audit }) => {
    const [plan] = await tx
      .select({ id: t.plans.id, name: t.plans.name })
      .from(t.plans)
      .where(eq(t.plans.id, request.planId))
      .limit(1)
      .for("update");
    if (!plan) refuse("That plan no longer exists.");

    const before = await tx
      .select()
      .from(t.planDurationRates)
      .where(eq(t.planDurationRates.planId, plan.id));

    const changes: string[] = [];
    let offered = 0;
    for (const days of PLAN_DURATIONS) {
      const typed = byDuration.get(days) ?? "";
      const existing = before.find((row) => row.durationDays === days);
      const previous = existing?.active ? `${existing.ratePercent}%` : "not offered";

      if (typed === "") {
        if (existing?.active) {
          await tx
            .update(t.planDurationRates)
            .set({ active: false, updatedAt: now })
            .where(eq(t.planDurationRates.id, existing.id));
          changes.push(`${days}d ${previous} → not offered`);
        }
        continue;
      }

      offered += 1;
      const rate = decimal(typed);
      if (existing) {
        if (existing.active && decimal(existing.ratePercent) === rate) continue;
        await tx
          .update(t.planDurationRates)
          .set({ ratePercent: numericValue(rate), active: true, updatedAt: now })
          .where(eq(t.planDurationRates.id, existing.id));
      } else {
        await tx.insert(t.planDurationRates).values({
          id: newId("pdr", now),
          planId: plan.id,
          durationDays: days,
          ratePercent: numericValue(rate),
          active: true,
          createdAt: now,
          updatedAt: now,
        });
      }
      changes.push(`${days}d ${previous} → ${rate}%`);
    }

    if (changes.length > 0) {
      audit({
        action: "plan_updated",
        target: { type: "plan", id: plan.id, label: plan.name },
        details: withReason(
          `Updated ${plan.name}'s duration rates: ${changes.join(", ")}. ` +
            `Effective for new allocations only — existing allocations keep the term and rate they were sold at.`,
          request.reason,
        ),
      });
    }

    return { offered };
  });
}
