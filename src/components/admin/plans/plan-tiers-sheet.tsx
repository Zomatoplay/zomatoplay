"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { previewPlanTierAction, type TierPreviewResult } from "@/app/admin/actions";
import { formatUsdt } from "@/lib/currency";
import type { AdminPlan, AdminPlanRateTier } from "@/types/admin";

/**
 * The rate-ladder editor for one plan.
 *
 * WHAT AN OPERATOR IS ACTUALLY EDITING
 * ------------------------------------
 * A contiguous set of amount bands, each with a percentage. The percentage
 * means what `estimatedReturnPercent` means everywhere else in this codebase —
 * projected **total** return over the plan's whole term, not a periodic rate
 * (see `plan_rate_tiers` in the schema for why no conversion exists). The
 * copy below says so rather than leaving an operator to assume.
 *
 * WHY THE WHOLE LADDER IS ONE SAVE
 * --------------------------------
 * Contiguity is a property of the set: moving one boundary is invalid until
 * its neighbour moves too. Editing band-by-band would mean either forbidding
 * every intermediate state or allowing an invalid ladder to exist between
 * calls — and an allocation arriving in that window would be priced against a
 * half-written table. See `savePlanRateTiers`.
 *
 * WHAT THIS FORM'S VALIDATION IS AND IS NOT
 * -----------------------------------------
 * An affordance. The identical rules run again in
 * `savePlanRateTiers → validateTierLadder` against the plan row as Postgres
 * holds it, and the preview below does not evaluate anything locally at all —
 * it asks the server, so what an operator is shown is what the pricing
 * function will actually do.
 */

interface TierRow {
  /** Stable across edits so an existing band keeps its id — and its history. */
  key: string;
  id?: string;
  min: string;
  /** Empty means open-ended: this is the top band. */
  max: string;
  rate: string;
  active: boolean;
}

function toRows(tiers: AdminPlanRateTier[]): TierRow[] {
  return tiers.map((tier, index) => ({
    key: tier.id ?? `row-${index}`,
    id: tier.id,
    min: String(tier.minAmountUsdt),
    max: tier.maxAmountUsdt === null ? "" : String(tier.maxAmountUsdt),
    rate: String(tier.ratePercent),
    active: tier.active,
  }));
}

export function PlanTiersSheet({
  plan,
  open,
  onOpenChange,
  onSubmit,
  pending,
}: {
  plan: AdminPlan | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: {
    tiers: Array<{
      id?: string;
      minAmountUsdt: number;
      maxAmountUsdt: number | null;
      ratePercent: number;
      active: boolean;
    }>;
    reason?: string;
  }) => void;
  pending: boolean;
}) {
  const [rows, setRows] = useState<TierRow[]>([]);
  const [reason, setReason] = useState("");

  /*
   * Re-seed the form from the server's copy of the ladder.
   *
   * Keyed on the `plan` object, not on `open`: the parent re-reads after
   * `router.refresh()` and hands down a new object, so a save is followed by
   * the form showing what was actually stored rather than what was typed.
   * Typing does not re-run it — `rows` lives in this component, so the parent
   * does not re-render and the prop keeps its identity.
   *
   * The trade-off, stated because it is a real one: if the server's copy
   * changes while somebody is mid-edit, their unsaved rows are replaced by
   * what the database now holds. That is the right way round for a rate table
   * two operators could be editing at once — the alternative is saving a
   * ladder built on a view that is already stale.
   */
  useEffect(() => {
    if (!plan) return;
    setRows(toRows(plan.rateTiers));
    setReason("");
  }, [plan]);

  const problems = useMemo(() => validateRows(rows, plan), [rows, plan]);

  function update(key: string, patch: Partial<TierRow>) {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function addRow() {
    setRows((current) => {
      const last = current[current.length - 1];
      /*
       * A new band starts where the last one ended, and takes over as the
       * open-ended top — which is the only arrangement that stays valid. An
       * operator adding a row into the middle moves the boundaries by hand.
       */
      const start = last ? last.max || last.min : String(plan?.minInvestment ?? 0);
      const previous = last
        ? current.slice(0, -1).concat({ ...last, max: start })
        : current;
      return [
        ...previous,
        {
          key: `new-${Date.now()}-${current.length}`,
          min: start,
          max: "",
          rate: "",
          active: true,
        },
      ];
    });
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function handleSave() {
    if (problems.length > 0) return;
    onSubmit({
      tiers: rows.map((row) => ({
        id: row.id,
        minAmountUsdt: Number(row.min),
        maxAmountUsdt: row.max.trim() === "" ? null : Number(row.max),
        ratePercent: Number(row.rate),
        active: row.active,
      })),
      reason: reason.trim() || undefined,
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>Investment tiers · {plan?.name ?? "Plan"}</SheetTitle>
          <SheetDescription>
            The rate an allocation is sold at, by amount. Bands are half-open —
            the lower figure is included, the upper one is not — so exactly 50
            USDT falls into the band that <em>starts</em> at 50.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          <p className="rounded-xl border border-border bg-secondary/50 p-3 text-xs leading-relaxed text-muted-foreground">
            A tier&rsquo;s percentage is the{" "}
            <strong className="font-medium text-foreground">
              estimated total return over the plan&rsquo;s whole term
            </strong>
            , the same meaning as the plan&rsquo;s headline figure — not a daily
            or weekly rate. How often rewards are paid is the plan&rsquo;s reward
            frequency and is set separately. Changing a tier affects{" "}
            <strong className="font-medium text-foreground">
              new allocations only
            </strong>
            ; existing ones keep the tier and rate they were sold at.
          </p>

          {rows.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No tiers. Every allocation into this plan is priced at its own
              estimated return of {plan?.estimatedReturnPercent}%.
            </p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className="space-y-3 rounded-xl border border-border p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      Tier {index + 1}
                    </span>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={row.active}
                          onCheckedChange={(active) => update(row.key, { active })}
                          aria-label={`Tier ${index + 1} active`}
                        />
                        <span className="text-muted-foreground">Active</span>
                      </label>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove tier ${index + 1}`}
                        onClick={() => removeRow(row.key)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Stacks at 360px, three columns from `sm` up. */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`${row.key}-min`}>From (USDT)</Label>
                      <Input
                        id={`${row.key}-min`}
                        inputMode="decimal"
                        value={row.min}
                        onChange={(event) =>
                          update(row.key, { min: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${row.key}-max`}>Under (USDT)</Label>
                      <Input
                        id={`${row.key}-max`}
                        inputMode="decimal"
                        placeholder="No limit"
                        value={row.max}
                        onChange={(event) =>
                          update(row.key, { max: event.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${row.key}-rate`}>Rate (%)</Label>
                      <Input
                        id={`${row.key}-rate`}
                        inputMode="decimal"
                        value={row.rate}
                        onChange={(event) =>
                          update(row.key, { rate: event.target.value })
                        }
                      />
                    </div>
                  </div>
                  {row.max.trim() === "" ? (
                    <p className="text-[11px] text-muted-foreground">
                      Open-ended: every amount at or above {row.min || "—"} USDT.
                      Only the highest tier may be open-ended.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus className="size-4" />
            Add tier
          </Button>

          {problems.length > 0 ? (
            <ul className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          {plan ? <TierPreview plan={plan} /> : null}

          <div className="space-y-1.5">
            <Label htmlFor="tier-reason">Reason (optional)</Label>
            <Input
              id="tier-reason"
              value={reason}
              placeholder="Why the rates changed"
              onChange={(event) => setReason(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Recorded on the audit entry alongside the before and after
              ladders.
            </p>
          </div>
        </SheetBody>

        <SheetFooter>
          <Button
            variant="brand"
            size="lg"
            block
            disabled={pending || problems.length > 0}
            onClick={handleSave}
          >
            {pending ? "Saving…" : "Save tiers"}
          </Button>
          <Button
            variant="ghost"
            size="lg"
            block
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * "What would this amount be sold at?", answered by the server.
 *
 * Deliberately **not** computed from the rows above: it prices against the
 * ladder currently *saved*, using `resolveRateForAmount` — the same function
 * `createInvestment` calls. So it answers the question an operator actually
 * has ("what is a customer getting right now?") rather than reflecting their
 * unsaved draft back at them, and it cannot drift from the real rule because
 * there is only one implementation of it.
 */
function TierPreview({ plan }: { plan: AdminPlan }) {
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<TierPreviewResult | null>(null);
  const [pending, startTransition] = useTransition();

  function check() {
    if (amount.trim() === "") return;
    startTransition(async () => {
      setResult(await previewPlanTierAction({ planId: plan.id, amount: amount.trim() }));
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
      <div>
        <p className="text-sm font-medium">Test an amount</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Priced against the tiers currently saved, by the same function that
          prices a real allocation. Save first to test a change.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input
          inputMode="decimal"
          placeholder="75"
          aria-label="Amount to test, in USDT"
          className="min-w-0 flex-1"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              check();
            }
          }}
        />
        <Button variant="outline" onClick={check} disabled={pending}>
          {pending ? "Pricing…" : "Price it"}
        </Button>
      </div>

      {result ? (
        result.ok && result.preview ? (
          <dl className="space-y-1.5 text-xs">
            <Row label="Amount">
              {formatUsdt(Number(result.preview.amountUsdt))}
            </Row>
            <Row label="Applicable tier">
              {result.preview.resolved.source === "plan" ? (
                <Badge variant="outline">No tiers · plan rate</Badge>
              ) : result.preview.resolved.maxAmountUsdt === null ? (
                `${result.preview.resolved.minAmountUsdt}+ USDT`
              ) : (
                `${result.preview.resolved.minAmountUsdt}–${result.preview.resolved.maxAmountUsdt} USDT`
              )}
            </Row>
            <Row label="Rate">{result.preview.resolved.ratePercent}%</Row>
            <Row label="Projected profit">
              {formatUsdt(Number(result.preview.projectedProfitUsdt))}
            </Row>
          </dl>
        ) : (
          <p className="text-xs text-destructive">
            {result.message ?? "Could not price that amount."}
          </p>
        )
      ) : null}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular font-medium">{children}</dd>
    </div>
  );
}

/**
 * The same checks `validateTierLadder` makes, in the browser, so the operator
 * sees them as they type.
 *
 * Kept as a small independent copy rather than importing the server module:
 * `plan-tiers.ts` imports `@/db/money`, which pulls `drizzle-orm` into the
 * client bundle for a handful of comparisons on numbers a form has already
 * turned into floats. The server's version is the one that decides — this one
 * only decides whether the Save button is enabled, and the server refuses
 * anything that reaches it anyway.
 */
function validateRows(rows: TierRow[], plan: AdminPlan | undefined): string[] {
  const problems: string[] = [];
  if (rows.length === 0) return problems;

  const parsed = rows.map((row, index) => ({
    index,
    min: Number(row.min),
    max: row.max.trim() === "" ? null : Number(row.max),
    rate: Number(row.rate),
  }));

  for (const row of parsed) {
    const label = `Tier ${row.index + 1}`;
    if (!Number.isFinite(row.min) || row.min < 0) {
      problems.push(`${label}: enter a lower bound of zero or more.`);
    }
    if (row.max !== null && (!Number.isFinite(row.max) || row.max <= row.min)) {
      problems.push(`${label}: the upper bound must be above the lower bound.`);
    }
    if (!Number.isFinite(row.rate) || row.rate <= 0) {
      problems.push(`${label}: enter a rate above zero.`);
    }
  }
  if (problems.length > 0) return problems;

  const sorted = [...parsed].sort((a, b) => a.min - b.min);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    if (sorted[i].min === sorted[i + 1].min) {
      problems.push(`Two tiers both start at ${sorted[i].min} USDT.`);
      continue;
    }
    if (sorted[i].max === null) {
      problems.push("Only the highest tier may be open-ended.");
      continue;
    }
    if (sorted[i].max! > sorted[i + 1].min) {
      problems.push(
        `Tiers starting at ${sorted[i].min} and ${sorted[i + 1].min} USDT overlap.`,
      );
    } else if (sorted[i].max! < sorted[i + 1].min) {
      problems.push(
        `Nothing covers ${sorted[i].max}–${sorted[i + 1].min} USDT. Tiers must be contiguous.`,
      );
    }
  }

  if (plan) {
    const lowest = sorted[0];
    const highest = sorted[sorted.length - 1];
    if (lowest.min > plan.minInvestment) {
      problems.push(
        `The lowest tier starts at ${lowest.min} USDT but the plan accepts from ${plan.minInvestment} USDT.`,
      );
    }
    if (highest.max !== null && highest.max <= plan.maxInvestment) {
      problems.push(
        `The highest tier ends at ${highest.max} USDT but the plan accepts up to ${plan.maxInvestment} USDT. Leave its upper bound empty.`,
      );
    }
  }

  return problems;
}
