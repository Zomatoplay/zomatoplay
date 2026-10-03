"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { RiskIndicator } from "@/components/plans/risk-indicator";
import { EmptyState } from "@/components/shared/empty-state";
import { InfoRow } from "@/components/shared/info-row";
import { RiskNote } from "@/components/shared/notices";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { rewardFrequencyLabels } from "@/data/plans";
import { formatUsdt } from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";
import type { Plan } from "@/types";
import { formatDate, progressPercent } from "@/utils/format";
import { endAllocationAction } from "@/app/(app)/plans/actions";

/**
 * Detail view for a single investment. Reads from the store rather than the
 * seed data so allocations created during the session resolve too.
 */
export function InvestmentDetail({
  id,
  plans,
}: {
  id: string;
  /** The catalogue, read server-side — the plan's terms are shown alongside. */
  plans: Plan[];
}) {
  const { investments } = usePrototypeStore();
  const investment = investments.find((item) => item.id === id);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!investment) {
    return (
      <EmptyState
        icon={Layers}
        title="Investment not found"
        description="We couldn't find this allocation. It may have been removed."
        action={
          <Button asChild size="sm" variant="brand">
            <Link href="/settings/investments">Back to investments</Link>
          </Button>
        }
      />
    );
  }

  const plan = plans.find((item) => item.id === investment.planId);
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
        />
        {investment.appliedRatePercent ? (
          <InfoRow
            label="Return"
            value={`${investment.appliedRatePercent}%`}
            hint={openEnded ? undefined : `Total over ${investment.durationDays} days`}
          />
        ) : null}
        <InfoRow
          label="Projected profit"
          value={formatUsdt(investment.projectedProfit)}
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

      {/*
        Returning an open-ended allocation.
        
        Shown only for a plan with no lock-in and only while the allocation is
        running. A fixed-term plan's early exit carries a fee or a forfeiture
        that nothing implements, so offering the button there would promise
        something the server would refuse.
      */}
      {openEnded && investment.status === "active" ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-5">
          <p className="text-sm font-medium text-foreground">
            Return funds to your balance
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {formatUsdt(investment.amount)} moves back to your available balance
            immediately. There is no lock-in on this plan and no exit fee.
          </p>
          {confirming ? (
            <div className="flex gap-2 pt-1">
              <Button
                variant="brand"
                size="lg"
                className="flex-1"
                disabled={pending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await endAllocationAction({
                      investmentId: investment.id,
                    });
                    if (!result.ok) {
                      toast.error(result.message);
                      return;
                    }
                    toast.success(result.message);
                    setConfirming(false);
                    // The balance now lives in the database; re-read rather
                    // than assume what it became.
                    router.refresh();
                  });
                }}
              >
                {pending ? "Returning…" : "Yes, return the funds"}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              size="lg"
              block
              className="mt-1"
              onClick={() => setConfirming(true)}
            >
              <Undo2 className="size-4" aria-hidden />
              Return {formatUsdt(investment.amount)}
            </Button>
          )}
        </div>
      ) : null}

      {plan ? (
        <Button asChild variant="outline" size="lg" block>
          <Link href={`/plans/${plan.slug}`}>View plan details</Link>
        </Button>
      ) : null}
    </div>
  );
}
