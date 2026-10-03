"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  durationLabel,
  durationRateRefusal,
  PLAN_DURATIONS,
  type DurationRateDraft,
} from "@/lib/plan-durations";
import type { AdminPlan } from "@/types/admin";

/**
 * The per-duration return editor for one plan: one percentage per selectable
 * term, each the TOTAL return over that term. A blank field means the term is
 * not offered — no figure is ever filled in for the operator. The same rules
 * run again in `savePlanDurationRates`; this form's checks are an affordance.
 */
export function PlanDurationsSheet({
  plan,
  open,
  onOpenChange,
  pending,
  onSubmit,
}: {
  plan: AdminPlan | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  onSubmit: (input: { rates: DurationRateDraft[]; reason?: string }) => void;
}) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");

  // Re-seeded from the server's copy after every save (see PlanTiersSheet).
  useEffect(() => {
    if (!plan) return;
    const next: Record<number, string> = {};
    for (const days of PLAN_DURATIONS) {
      const row = plan.durationRates.find((r) => r.durationDays === days && r.active);
      next[days] = row ? String(row.ratePercent) : "";
    }
    setValues(next);
    setReason("");
  }, [plan]);

  const problems = useMemo(
    () =>
      PLAN_DURATIONS.flatMap((days) => {
        const problem = durationRateRefusal(values[days] ?? "");
        return problem ? [`${durationLabel(days)}: ${problem}`] : [];
      }),
    [values],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Duration returns{plan ? ` · ${plan.name}` : ""}</SheetTitle>
          <SheetDescription>
            The total return a customer receives for each term they can choose,
            paid weekly and pro rata by days (15 days pays 7/15, 7/15, then 1/15
            at maturity). Leave a term blank to not offer it. Changes apply to
            new allocations only.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <ul className="space-y-3">
            {PLAN_DURATIONS.map((days) => (
              <li key={days} className="flex items-center gap-3">
                <Label htmlFor={`duration-${days}`} className="w-20 shrink-0">
                  {durationLabel(days)}
                </Label>
                <div className="relative flex-1">
                  <Input
                    id={`duration-${days}`}
                    inputMode="decimal"
                    placeholder="Not offered"
                    value={values[days] ?? ""}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [days]: event.target.value }))
                    }
                    className="pr-8"
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                    %
                  </span>
                </div>
              </li>
            ))}
          </ul>

          {problems.length > 0 ? (
            <ul className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="duration-reason">Reason (optional)</Label>
            <Input
              id="duration-reason"
              value={reason}
              placeholder="Why the returns changed"
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Recorded on the audit entry with the before and after rates.
            </p>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button
            variant="brand"
            size="lg"
            block
            disabled={pending || problems.length > 0 || !plan}
            onClick={() =>
              onSubmit({
                rates: PLAN_DURATIONS.map((days) => ({
                  durationDays: days,
                  ratePercent: (values[days] ?? "").trim(),
                })),
                reason: reason.trim() || undefined,
              })
            }
          >
            {pending ? "Saving…" : "Save duration returns"}
          </Button>
          <Button variant="ghost" size="lg" block disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
