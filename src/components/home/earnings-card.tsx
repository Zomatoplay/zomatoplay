"use client";

import { TrendingDown, TrendingUp } from "lucide-react";

import { EarningsChart } from "@/components/shared/earnings-chart";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPercent, formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { EarningsSummary } from "@/types";

function ChangeChip({ value }: { value: number }) {
  const positive = value >= 0;
  const Icon = positive ? TrendingUp : TrendingDown;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        positive ? "bg-brand-soft text-positive" : "bg-destructive/10 text-destructive",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {formatPercent(Math.abs(value), 1)}
    </span>
  );
}

/**
 * Earnings overview: this week / this month / total, with a single-series
 * chart for whichever period is selected.
 */
export function EarningsCard({
  earnings,
  className,
}: {
  earnings: EarningsSummary;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <Tabs defaultValue="week">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold tracking-tight">Earnings</h2>
          <TabsList className="w-auto">
            <TabsTrigger value="week" className="px-4">
              Week
            </TabsTrigger>
            <TabsTrigger value="month" className="px-4">
              Month
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="week" className="space-y-4">
          <div className="flex items-center gap-2">
            <ChangeChip value={earnings.weekChangePercent} />
            <span className="text-xs text-muted-foreground">vs last week</span>
          </div>
          <EarningsChart
            points={earnings.weekly}
            total={earnings.thisWeek}
            totalLabel="This week"
          />
        </TabsContent>

        <TabsContent value="month" className="space-y-4">
          <div className="flex items-center gap-2">
            <ChangeChip value={earnings.monthChangePercent} />
            <span className="text-xs text-muted-foreground">vs last month</span>
          </div>
          <EarningsChart
            points={earnings.monthly}
            total={earnings.thisMonth}
            totalLabel="This month"
          />
        </TabsContent>
      </Tabs>

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
        {[
          { term: "This week", value: earnings.thisWeek },
          { term: "This month", value: earnings.thisMonth },
          { term: "Total profit", value: earnings.total },
        ].map((item) => (
          <div key={item.term} className="min-w-0">
            <dt className="truncate text-[11px] font-medium text-muted-foreground">
              {item.term}
            </dt>
            <dd className="tabular mt-0.5 text-sm font-semibold text-foreground">
              {formatUsdt(item.value, { withSymbol: false })}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
