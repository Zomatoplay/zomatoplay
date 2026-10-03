"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { planStatusDescriptions } from "@/data/admin/plans";
import { rewardFrequencyLabels, riskLabels } from "@/data/plans";
import type { PlanInput as PlanDraft } from "@/app/admin/actions";
import { cn } from "@/lib/utils";
import type { AdminPlan, AdminPlanStatus } from "@/types/admin";
import type { RewardFrequency, RiskLevel } from "@/types";

/**
 * Create / edit form for an investment plan.
 *
 * Validation is deliberately about coherence rather than formatting: a maximum
 * below the minimum would produce a plan the user-facing screens cannot render
 * sensibly.
 *
 * Plans show ONE return figure (client decision, 2026-10), so there is no range
 * to enter: the stored low/high columns are kept equal to the headline rate on
 * save. Per-duration returns are edited separately (Durations).
 */

const EMPTY: PlanDraft = {
  name: "",
  tagline: "",
  description: "",
  minInvestment: 100,
  maxInvestment: 10000,
  durationDays: 90,
  estimatedReturnPercent: 8,
  estimatedReturnRange: [6, 10],
  rewardFrequency: "weekly",
  risk: "balanced",
  status: "open",
};

function toDraft(plan: AdminPlan): PlanDraft {
  return {
    name: plan.name,
    tagline: plan.tagline,
    description: plan.description,
    minInvestment: plan.minInvestment,
    maxInvestment: plan.maxInvestment,
    durationDays: plan.durationDays,
    estimatedReturnPercent: plan.estimatedReturnPercent,
    estimatedReturnRange: plan.estimatedReturnRange,
    rewardFrequency: plan.rewardFrequency,
    risk: plan.risk,
    status: plan.status,
  };
}

function validate(draft: PlanDraft): string[] {
  const errors: string[] = [];
  if (draft.name.trim() === "") errors.push("A plan name is required.");
  if (draft.minInvestment <= 0)
    errors.push("The minimum allocation must be above zero.");
  if (draft.maxInvestment < draft.minInvestment)
    errors.push("The maximum allocation cannot be below the minimum.");
  if (draft.durationDays < 0)
    errors.push("The term cannot be negative. Use 0 for an open-ended plan.");
  if (!(draft.estimatedReturnPercent > 0))
    errors.push("The return must be above zero.");
  return errors;
}

export function PlanFormSheet({
  mode,
  plan,
  open,
  onOpenChange,
  onSubmit,
}: {
  mode: "create" | "edit";
  plan?: AdminPlan;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: PlanDraft) => void;
}) {
  const [draft, setDraft] = useState<PlanDraft>(plan ? toDraft(plan) : EMPTY);
  const [touched, setTouched] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Re-seed on every open, so a cancelled edit leaves nothing behind.
      setDraft(plan ? toDraft(plan) : EMPTY);
      setTouched(false);
    }
    onOpenChange(next);
  }

  function set<K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) {
    setDraft((current: PlanDraft) => ({ ...current, [key]: value }));
  }

  const errors = validate(draft);
  const valid = errors.length === 0;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "Create plan" : `Edit ${plan?.name ?? "plan"}`}
          </SheetTitle>
          <SheetDescription>
            These values drive what users see. Each plan shows one return
            figure; set per-duration returns with Durations.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <Field id="plan-name" label="Plan name">
            <Input
              id="plan-name"
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Balanced Growth"
            />
          </Field>

          <Field id="plan-tagline" label="Tagline">
            <Input
              id="plan-tagline"
              value={draft.tagline}
              onChange={(event) => set("tagline", event.target.value)}
              placeholder="Our most popular allocation"
            />
          </Field>

          <Field id="plan-description" label="Description">
            <Textarea
              id="plan-description"
              value={draft.description}
              onChange={(event) => set("description", event.target.value)}
              placeholder="What this plan is and who it suits…"
              className="min-h-24 text-sm"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="plan-min" label="Minimum allocation (USDT)">
              <Input
                id="plan-min"
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.minInvestment}
                onChange={(event) =>
                  set("minInvestment", Number(event.target.value))
                }
              />
            </Field>
            <Field id="plan-max" label="Maximum allocation (USDT)">
              <Input
                id="plan-max"
                type="number"
                inputMode="decimal"
                min={0}
                value={draft.maxInvestment}
                onChange={(event) =>
                  set("maxInvestment", Number(event.target.value))
                }
              />
            </Field>
          </div>

          <Field
            id="plan-duration"
            label="Term in days"
            hint="Use 0 for an open-ended plan with no lock-in."
          >
            <Input
              id="plan-duration"
              type="number"
              inputMode="numeric"
              min={0}
              value={draft.durationDays}
              onChange={(event) =>
                set("durationDays", Number(event.target.value))
              }
            />
          </Field>

          <Field
            id="plan-return"
            label="Total return over the term (%)"
            hint="The single figure shown for this plan's own term. Used only when no duration returns are set."
          >
            <Input
              id="plan-return"
              type="number"
              inputMode="decimal"
              step="0.1"
              value={draft.estimatedReturnPercent}
              onChange={(event) =>
                set("estimatedReturnPercent", Number(event.target.value))
              }
            />
          </Field>


          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="plan-frequency"
              label="Reward frequency"
              value={draft.rewardFrequency}
              onChange={(value) =>
                set("rewardFrequency", value as RewardFrequency)
              }
              options={Object.entries(rewardFrequencyLabels).map(
                ([value, label]) => ({ value, label }),
              )}
            />
            <SelectField
              id="plan-risk"
              label="Risk level"
              value={draft.risk}
              onChange={(value) => set("risk", value as RiskLevel)}
              options={Object.entries(riskLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </div>

          <SelectField
            id="plan-status"
            label="Status"
            value={draft.status}
            onChange={(value) => set("status", value as AdminPlanStatus)}
            options={(
              Object.keys(planStatusDescriptions) as AdminPlanStatus[]
            ).map((value) => ({
              value,
              label: value.charAt(0).toUpperCase() + value.slice(1),
            }))}
            hint={planStatusDescriptions[draft.status]}
          />

          {touched && !valid ? (
            <ul className="space-y-1 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
              {errors.map((error) => (
                <li key={error} className="text-xs leading-relaxed text-destructive">
                  {error}
                </li>
              ))}
            </ul>
          ) : null}
        </SheetBody>

        <SheetFooter className="sm:flex-row-reverse">
          <Button
            variant="brand"
            block
            className="sm:w-auto sm:flex-1"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSubmit({ ...draft, name: draft.name.trim() });
              onOpenChange(false);
            }}
          >
            {mode === "create" ? "Create plan" : "Save changes"}
          </Button>
          <Button
            variant="outline"
            block
            className="sm:w-auto sm:flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  hint?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          "h-12 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground transition-colors",
          "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-ring/40",
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
