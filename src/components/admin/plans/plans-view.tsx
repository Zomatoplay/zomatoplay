"use client";

import { useState } from "react";
import { Layers, PencilLine, Plus, Power, PowerOff, SlidersHorizontal } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { PlanFormSheet } from "@/components/admin/plans/plan-form-sheet";
import { PlanTiersSheet } from "@/components/admin/plans/plan-tiers-sheet";
import { EmptyState } from "@/components/shared/empty-state";
import { RiskNote } from "@/components/shared/notices";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { planStatusDescriptions } from "@/data/admin/plans";
import { rewardFrequencyLabels, riskLabels } from "@/data/plans";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import {
  createPlanAction,
  savePlanTiersAction,
  setPlanDisabledAction,
  updatePlanAction,
} from "@/app/admin/actions";
import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { AdminPlan } from "@/types/admin";
import { formatDate } from "@/utils/format";

/**
 * Plan catalogue management.
 *
 * Plans are cards rather than table rows: an operator editing one is weighing
 * several parameters against each other (minimum, term, projected range, risk),
 * and a card shows them together.
 */

export function PlansView() {
  return (
    <>
      <AdminHeader
        title="Plans"
        description="Create, edit and withdraw the investment products users can allocate into."
      />
      <AdminPage>
        <PermissionGate permission="plans">
          <PlansManager />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function PlansManager() {
  const store = useAdminStore();
  const { run, pending } = useAdminAction();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminPlan | null>(null);
  const [tiering, setTiering] = useState<AdminPlan | null>(null);
  const [toggling, setToggling] = useState<AdminPlan | null>(null);

  /*
   * Re-read from the store rather than holding the plan the button captured.
   *
   * `router.refresh()` after a save hands the page a new `plans` array, and a
   * sheet still holding the old object would show the ladder as it was before
   * the save — which reads as the save having failed.
   */
  const tieringPlan = tiering
    ? (store.plans.find((plan) => plan.id === tiering.id) ?? tiering)
    : undefined;

  const allowed = canManage(store.session, "plans");

  return (
    <AdminSection
      className="space-y-4"
      actions={
        <Button
          variant="brand"
          size="sm"
          disabled={!allowed}
          onClick={() => setCreating(true)}
        >
          <Plus className="size-4" />
          Create plan
        </Button>
      }
    >
      <RiskNote>
        Plan copy and projections must never present returns as guaranteed.
        Always describe them as estimated or projected, and keep the range
        visible — the user-facing screens render these values directly.
      </RiskNote>

      {store.plans.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No plans"
          description="Create a plan to give users something to allocate into."
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {store.plans.map((plan) => (
            <li key={plan.id}>
              <PlanCard
                plan={plan}
                allowed={allowed}
                onEdit={() => setEditing(plan)}
                onTiers={() => setTiering(plan)}
                onToggle={() => setToggling(plan)}
              />
            </li>
          ))}
        </ul>
      )}

      <PlanFormSheet
        mode="create"
        open={creating}
        onOpenChange={setCreating}
        onSubmit={(draft) => {
          run(() => createPlanAction(draft), { onSuccess: () => setCreating(false) });
        }}
      />

      <PlanFormSheet
        mode="edit"
        plan={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSubmit={(draft) => {
          if (!editing) return;
          run(() => updatePlanAction({ planId: editing.id, plan: draft }), {
            onSuccess: () => setEditing(null),
          });
        }}
      />

      <PlanTiersSheet
        plan={tieringPlan}
        open={tiering !== null}
        onOpenChange={(open) => !open && setTiering(null)}
        pending={pending}
        onSubmit={({ tiers, reason }) => {
          if (!tiering) return;
          run(() => savePlanTiersAction({ planId: tiering.id, tiers, reason }), {
            onSuccess: () => setTiering(null),
          });
        }}
      />

      <ConfirmActionDialog
        open={toggling !== null}
        onOpenChange={(open) => !open && setToggling(null)}
        title={
          toggling?.status === "disabled" ? "Re-open this plan?" : "Disable this plan?"
        }
        description={
          toggling ? (
            toggling.status === "disabled" ? (
              <>
                <strong className="font-medium text-foreground">
                  {toggling.name}
                </strong>{" "}
                will appear in the app again and accept new allocations.
              </>
            ) : (
              <>
                <strong className="font-medium text-foreground">
                  {toggling.name}
                </strong>{" "}
                will be withdrawn from the app entirely. Its{" "}
                {toggling.stats.activeInvestments} existing{" "}
                {toggling.stats.activeInvestments === 1
                  ? "allocation continues"
                  : "allocations continue"}{" "}
                to run to maturity.
              </>
            )
          ) : null
        }
        confirmLabel={
          toggling?.status === "disabled" ? "Re-open plan" : "Disable plan"
        }
        destructive={toggling?.status !== "disabled"}
        reason={{ label: "Reason", required: toggling?.status !== "disabled" }}
        onConfirm={(reason) => {
          if (!toggling) return;
          // The public catalogue reads the same `plans` rows, so disabling here
          // withdraws the plan from the user application too. That is the whole
          // point: an admin change that left `/plans` reading a separate
          // hardcoded constant would look successful and do nothing.
          run(() =>
            setPlanDisabledAction({
              planId: toggling.id,
              disabled: toggling.status !== "disabled",
              note: reason,
            }),
          );
          setToggling(null);
        }}
      />
    </AdminSection>
  );
}

function PlanCard({
  plan,
  allowed,
  onEdit,
  onTiers,
  onToggle,
}: {
  plan: AdminPlan;
  allowed: boolean;
  onEdit: () => void;
  onTiers: () => void;
  onToggle: () => void;
}) {
  const disabled = plan.status === "disabled";

  return (
    <article
      className={cn(
        "flex h-full flex-col rounded-2xl border border-border bg-card p-4",
        disabled && "opacity-70",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{plan.name}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {plan.tagline}
          </p>
        </div>
        <AdminStatusBadge kind="plan" status={plan.status} />
      </header>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        {planStatusDescriptions[plan.status]}
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3">
        <Field label="Allocation range">
          {formatUsdt(plan.minInvestment, { withSymbol: false })} –{" "}
          {formatUsdt(plan.maxInvestment, { withSymbol: false, compact: true })}
        </Field>
        <Field label="Term">
          {plan.durationDays === 0 ? "No lock-in" : `${plan.durationDays} days`}
        </Field>
        <Field label="Projected return">
          {plan.estimatedReturnRange[0]}% – {plan.estimatedReturnRange[1]}%
          <span className="ml-1 font-normal text-muted-foreground">est.</span>
        </Field>
        <Field label="Rewards">
          {rewardFrequencyLabels[plan.rewardFrequency]}
        </Field>
        <Field label="Risk">{riskLabels[plan.risk]}</Field>
        <Field label="Updated">{formatDate(plan.updatedAt)}</Field>
      </dl>

      {plan.status === "limited" && plan.capacityFilledPercent !== undefined ? (
        <div className="mt-3 space-y-1.5">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">Capacity filled</span>
            <span className="tabular font-medium">
              {plan.capacityFilledPercent}%
            </span>
          </div>
          <Progress value={plan.capacityFilledPercent} />
        </div>
      ) : null}

      {/*
        The ladder, on the card. An operator deciding whether to edit a plan's
        rates needs to see what they currently are, and a card that showed only
        the headline percentage made a three-band plan look like a one-rate
        one. Inactive bands are shown too, marked — they are configuration that
        still exists.
      */}
      <div className="mt-3 border-t border-border pt-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Rate tiers
        </p>
        {plan.rateTiers.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">
            None — every allocation is priced at {plan.estimatedReturnPercent}%.
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {plan.rateTiers.map((tier) => (
              <li
                key={tier.id}
                className="tabular flex items-baseline justify-between gap-3 text-xs"
              >
                <span className={cn("text-muted-foreground", !tier.active && "line-through")}>
                  {tier.maxAmountUsdt === null
                    ? `${formatUsdt(tier.minAmountUsdt, { withSymbol: false, compact: true })}+ USDT`
                    : `${formatUsdt(tier.minAmountUsdt, { withSymbol: false, compact: true })}–${formatUsdt(tier.maxAmountUsdt, { withSymbol: false, compact: true })} USDT`}
                </span>
                <span className="font-medium">
                  {tier.ratePercent}%
                  {tier.active ? null : (
                    <span className="ml-1 font-normal text-muted-foreground">
                      inactive
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          <span className="tabular font-medium text-foreground">
            {plan.stats.activeInvestments}
          </span>{" "}
          active
        </span>
        <span>
          <span className="tabular font-medium text-foreground">
            {formatUsdt(plan.stats.totalAllocated, {
              withSymbol: false,
              compact: true,
            })}
          </span>{" "}
          allocated
        </span>
        <span>
          <span className="tabular font-medium text-positive">
            {formatUsdt(plan.stats.totalProfitPaid, {
              withSymbol: false,
              compact: true,
            })}
          </span>{" "}
          profit paid
        </span>
      </div>

      {/* Wraps at 360px rather than squeezing three controls onto one row. */}
      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!allowed}
          onClick={onEdit}
        >
          <PencilLine className="size-4" />
          Edit
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!allowed}
          onClick={onTiers}
        >
          <SlidersHorizontal className="size-4" />
          Tiers
        </Button>
        <Button
          variant={disabled ? "brand" : "ghost"}
          size="sm"
          className="flex-1"
          disabled={!allowed}
          onClick={onToggle}
        >
          {disabled ? (
            <>
              <Power className="size-4" />
              Re-open
            </>
          ) : (
            <>
              <PowerOff className="size-4" />
              Disable
            </>
          )}
        </Button>
      </div>
    </article>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="tabular mt-0.5 text-sm font-medium">{children}</dd>
    </div>
  );
}
