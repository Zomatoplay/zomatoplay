import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

import { InvestSheet } from "@/components/plans/invest-sheet";
import { RiskIndicator } from "@/components/plans/risk-indicator";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { rewardFrequencyLabels } from "@/data/plans";
import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { Plan } from "@/types";

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-medium text-muted-foreground">
        {label}
      </p>
      <p className="tabular mt-0.5 truncate text-sm font-semibold text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="tabular truncate text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function PlanCard({ plan, className }: { plan: Plan; className?: string }) {
  const closed = plan.status === "closed";
  const durations = plan.durationRates.filter((row) => row.active);

  return (
    <article
      className={cn(
        "rounded-2xl border border-border bg-card p-5",
        closed && "opacity-75",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-foreground">
              {plan.name}
            </h3>
            {plan.popular ? (
              <Badge variant="brand">
                <Sparkles aria-hidden />
                Popular
              </Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {plan.tagline}
          </p>
        </div>
        <StatusBadge kind="plan" status={plan.status} className="shrink-0" />
      </div>

      {/*
        One applicable return per term — never a range. With durations
        configured, each term shows its own single figure; otherwise the plan's
        one term and rate.
      */}
      {durations.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-medium text-muted-foreground">
            Estimated total return by duration
          </p>
          <ul className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {durations.map((row) => (
              <li key={row.id} className="rounded-xl bg-secondary/60 px-2 py-2 text-center">
                <p className="text-[11px] text-muted-foreground">{row.durationDays} days</p>
                <p className="tabular text-base font-semibold text-positive">{row.ratePercent}%</p>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-secondary/60 p-3">
          <p className="text-[11px] font-medium text-muted-foreground">
            Estimated total return
          </p>
          <p className="tabular mt-0.5 text-2xl font-semibold tracking-tight text-positive">
            {plan.estimatedReturnPercent}%
          </p>
          <p className="tabular text-[11px] text-muted-foreground">
            {plan.durationDays === 0 ? "No fixed term" : `Over ${plan.durationDays} days`}
          </p>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric
          label="From"
          value={formatUsdt(plan.minInvestment, { withSymbol: false })}
        />
        <Metric
          label="Duration"
          value={
            durations.length > 0
              ? `${durations[0].durationDays}–${durations[durations.length - 1].durationDays} days`
              : plan.durationDays === 0
                ? "Flexible"
                : `${plan.durationDays} days`
          }
        />
        <Metric
          label="Rewards"
          value={durations.length > 0 ? "Weekly" : rewardFrequencyLabels[plan.rewardFrequency]}
        />
      </div>

      {plan.status === "limited" && plan.capacityFilledPercent !== undefined ? (
        <div className="mt-4 space-y-1.5">
          <Progress
            value={plan.capacityFilledPercent}
            indicatorClassName="bg-warning"
            aria-label="Capacity filled"
          />
          <p className="tabular text-[11px] text-muted-foreground">
            {plan.capacityFilledPercent}% of this cohort allocated
          </p>
        </div>
      ) : null}

      {/*
        The rate ladder, where the plan has one.

        Shown on the card because it is the answer to the first question this
        card raises once bands exist — "what do I get for the amount I have?" —
        and sending somebody to the detail page to find out makes the headline
        percentage above read as the whole story when it is one band of it.
        Scrolls inside its own container so a three-band ladder never widens
        the page at 360px (CLAUDE.md §7).
      */}
      {durations.length === 0 && plan.rateTiers.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] font-medium text-muted-foreground">
            Rate by allocation amount
          </p>
          {/*
            The `<ul>` is the scroll container itself, so `.edge-scroll > *`
            puts a snap point on every chip rather than one on a single wrapper
            — a `mandatory` snap axis with one snap position pins the scroller
            at its start and the row cannot be scrolled at all.
          */}
          <ul className="no-scrollbar edge-scroll mt-1.5 flex gap-2 overflow-x-auto">
              {plan.rateTiers.map((tier) => (
                <li
                  key={tier.id}
                  className="shrink-0 rounded-xl border border-border px-3 py-2"
                >
                  <p className="tabular text-[11px] text-muted-foreground">
                    {tierBandLabel(tier)}
                  </p>
                  <p className="tabular text-sm font-semibold text-positive">
                    {tier.ratePercent}%
                  </p>
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
        <RiskIndicator risk={plan.risk} />
        <Link
          href={`/plans/${plan.slug}`}
          className="inline-flex items-center gap-0.5 rounded-full py-1 pl-2 text-sm font-medium text-brand transition-colors hover:text-brand/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View Details
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </div>

      {/*
        The allocation action, on the card itself.

        It was only on the detail page, so the browse screen listed products
        with no way to buy one — a person had to guess that "View Details" was
        also the route to investing. The sheet is the same component the detail
        page uses, so there is one investment flow and one set of rules, not a
        second shorter one that could drift from it.
      */}
      <div className="mt-3">
        <InvestSheet plan={plan} />
      </div>
    </article>
  );
}

/** `50–100 USDT` / `100+ USDT`, the band as a person reads it. */
function tierBandLabel(tier: Plan["rateTiers"][number]): string {
  const from = formatUsdt(tier.minAmountUsdt, { withSymbol: false, compact: true });
  if (tier.maxAmountUsdt === null) return `${from}+`;
  const to = formatUsdt(tier.maxAmountUsdt, { withSymbol: false, compact: true });
  return `${from}–${to}`;
}
