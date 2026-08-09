import Link from "next/link";
import { CalendarClock, ChevronRight } from "lucide-react";

import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusBadge } from "@/components/shared/status-badge";
import { Progress } from "@/components/ui/progress";
import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { formatDate, progressPercent } from "@/utils/format";
import type { Investment } from "@/types";

/**
 * A single active or matured investment. Used on Home, Wallet and the
 * investment history screens.
 */
export function InvestmentCard({
  investment,
  className,
}: {
  investment: Investment;
  className?: string;
}) {
  const openEnded = investment.durationDays === 0;
  const percent = openEnded
    ? 100
    : progressPercent(investment.elapsedDays, investment.durationDays);

  return (
    <Link
      href={`/settings/investments/${investment.id}`}
      className={cn(
        "block rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-secondary/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {investment.planName}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {openEnded
              ? "No lock-in"
              : `${investment.durationDays}-day term · ends ${formatDate(investment.endDate)}`}
          </p>
        </div>
        <StatusBadge
          kind="investment"
          status={investment.status}
          className="shrink-0"
        />
      </div>

      <div className="mt-4 flex items-end justify-between gap-3">
        <CurrencyDisplay
          amount={investment.amount}
          size="sm"
          label="Invested"
          className="min-w-0"
        />
        <CurrencyDisplay
          amount={investment.profit}
          size="sm"
          tone="positive"
          signed
          label="Profit"
          className="min-w-0 items-end text-right [&>span]:text-right"
        />
      </div>

      {!openEnded ? (
        <div className="mt-4 space-y-1.5">
          <Progress value={percent} aria-label="Term progress" />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="tabular">
              Day {Math.min(investment.elapsedDays, investment.durationDays)} of{" "}
              {investment.durationDays}
            </span>
            <span className="tabular">{Math.round(percent)}%</span>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-3">
        {investment.nextRewardDate && investment.nextRewardAmount !== null ? (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              Next reward {formatDate(investment.nextRewardDate)} ·{" "}
              <span className="tabular font-medium text-foreground">
                {formatUsdt(investment.nextRewardAmount)}
              </span>
            </span>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Matured {formatDate(investment.endDate)}
          </span>
        )}
        <span className="flex shrink-0 items-center gap-0.5 text-xs font-medium text-brand">
          Details
          <ChevronRight className="size-3.5" aria-hidden />
        </span>
      </div>
    </Link>
  );
}
