"use client";

import Link from "next/link";
import { Layers } from "lucide-react";

import { RiskIndicator } from "@/components/plans/risk-indicator";
import { EmptyState } from "@/components/shared/empty-state";
import { InfoRow } from "@/components/shared/info-row";
import { RateNote, RiskNote } from "@/components/shared/notices";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getPlanById, rewardFrequencyLabels } from "@/data/plans";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";
import { formatDate, progressPercent } from "@/utils/format";

/**
 * Detail view for a single investment. Reads from the store rather than the
 * seed data so allocations created during the session resolve too.
 */
export function InvestmentDetail({ id }: { id: string }) {
  const { investments } = usePrototypeStore();
  const investment = investments.find((item) => item.id === id);

  if (!investment) {
    return (
      <EmptyState
        icon={Layers}
        title="Investment not found"
        description="This allocation no longer exists, or the demo data was reset."
        action={
          <Button asChild size="sm" variant="brand">
            <Link href="/settings/investments">Back to investments</Link>
          </Button>
        }
      />
    );
  }

  const plan = getPlanById(investment.planId);
  const openEnded = investment.durationDays === 0;
  const percent = openEnded
    ? 100
    : progressPercent(investment.elapsedDays, investment.durationDays);
  const remainingDays = Math.max(
    investment.durationDays - investment.elapsedDays,
    0,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="investment" status={investment.status} />
        <RiskIndicator risk={investment.risk} />
      </div>

      <Card className="p-5">
        <p className="text-xs font-medium text-muted-foreground">
          Current profit
        </p>
        <p className="tabular mt-1 text-[2.125rem] font-semibold leading-10 tracking-tight text-positive">
          {formatUsdt(investment.profit, { signed: true })}
        </p>
        <p className="tabular mt-1 text-sm text-muted-foreground">
          {formatUsdtAsInr(investment.profit)}
        </p>

        {!openEnded ? (
          <div className="mt-5 space-y-1.5 border-t border-border pt-4">
            <Progress value={percent} aria-label="Term progress" />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="tabular">
                Day {Math.min(investment.elapsedDays, investment.durationDays)} of{" "}
                {investment.durationDays}
              </span>
              <span className="tabular">
                {remainingDays} {remainingDays === 1 ? "day" : "days"} remaining
              </span>
            </div>
          </div>
        ) : null}
      </Card>

      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
        <InfoRow label="Plan" value={investment.planName} />
        <InfoRow
          label="Amount invested"
          value={formatUsdt(investment.amount)}
          hint={formatUsdtAsInr(investment.amount)}
        />
        <InfoRow
          label="Projected profit"
          value={formatUsdt(investment.projectedProfit)}
          hint={formatUsdtAsInr(investment.projectedProfit)}
        />
        <InfoRow
          label="Reward frequency"
          value={rewardFrequencyLabels[investment.rewardFrequency]}
        />
        <InfoRow label="Started" value={formatDate(investment.startDate)} />
        {!openEnded ? (
          <InfoRow
            label={investment.status === "active" ? "Matures" : "Matured"}
            value={formatDate(investment.endDate)}
          />
        ) : (
          <InfoRow label="Term" value="No lock-in" />
        )}
        {investment.nextRewardDate && investment.nextRewardAmount !== null ? (
          <InfoRow
            label="Next reward"
            value={formatUsdt(investment.nextRewardAmount)}
            hint={formatDate(investment.nextRewardDate)}
          />
        ) : null}
        {plan ? <InfoRow label="Early exit" value={plan.earlyExit} /> : null}
      </div>

      <RiskNote />
      <RateNote />

      {plan ? (
        <Button asChild variant="outline" size="lg" block>
          <Link href={`/plans/${plan.slug}`}>View plan details</Link>
        </Button>
      ) : null}
    </div>
  );
}
