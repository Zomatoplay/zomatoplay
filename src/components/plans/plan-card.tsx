import Link from "next/link";
import { ChevronRight, Sparkles } from "lucide-react";

import { RiskIndicator } from "@/components/plans/risk-indicator";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { rewardFrequencyLabels } from "@/data/plans";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
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
  const [low, high] = plan.estimatedReturnRange;
  const closed = plan.status === "closed";

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

      {/* Estimated return is the headline figure, always qualified. */}
      <div className="mt-4 rounded-xl bg-secondary/60 p-3">
        <p className="text-[11px] font-medium text-muted-foreground">
          Estimated total return
        </p>
        <p className="tabular mt-0.5 text-2xl font-semibold tracking-tight text-positive">
          {plan.estimatedReturnPercent}%
        </p>
        <p className="tabular text-[11px] text-muted-foreground">
          Projected range {low}%–{high}% over the term · not guaranteed
        </p>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Metric
          label="From"
          value={formatUsdt(plan.minInvestment, { withSymbol: false })}
          hint={formatUsdtAsInr(plan.minInvestment)}
        />
        <Metric
          label="Duration"
          value={plan.durationDays === 0 ? "Flexible" : `${plan.durationDays} days`}
        />
        <Metric label="Rewards" value={rewardFrequencyLabels[plan.rewardFrequency]} />
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
    </article>
  );
}
