import { Card } from "@/components/ui/card";
import { monthlyEarningsHistory } from "@/data/investments";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { EarningsSummary } from "@/types";

/**
 * Wallet → Earnings. Weekly / monthly / total figures plus a month-by-month
 * history. Static content, so this stays a server component.
 */
export function EarningsBreakdown({
  earnings,
  className,
}: {
  earnings: EarningsSummary;
  className?: string;
}) {
  const peak = Math.max(...monthlyEarningsHistory.map((row) => row.amount));

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "This week", value: earnings.thisWeek },
          { label: "This month", value: earnings.thisMonth },
          { label: "All time", value: earnings.total },
        ].map((item) => (
          <div
            key={item.label}
            className="min-w-0 rounded-2xl border border-border bg-card p-4"
          >
            <p className="truncate text-[11px] font-medium text-muted-foreground">
              {item.label}
            </p>
            <p className="tabular mt-1 truncate text-base font-semibold text-positive">
              {formatUsdt(item.value, { withSymbol: false })}
            </p>
            <p className="tabular truncate text-[11px] text-muted-foreground">
              {formatUsdtAsInr(item.value)}
            </p>
          </div>
        ))}
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold">Previous months</h3>
        <ul className="mt-4 space-y-3.5">
          {monthlyEarningsHistory.map((row) => (
            <li key={row.month} className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm text-foreground">
                  {row.month}
                  {row.partial ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      so far
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right">
                  <span className="tabular block text-sm font-semibold text-foreground">
                    {formatUsdt(row.amount, { withSymbol: false })}
                  </span>
                  <span className="tabular block text-[11px] text-muted-foreground">
                    {formatUsdtAsInr(row.amount)}
                  </span>
                </span>
              </div>
              {/* Single-hue magnitude bar; length is the only encoding. */}
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                role="img"
                aria-label={`${row.month}: ${formatUsdt(row.amount)}`}
              >
                <div
                  className={cn(
                    "h-full rounded-full",
                    row.partial ? "bg-brand/45" : "bg-brand",
                  )}
                  style={{ width: `${peak > 0 ? (row.amount / peak) * 100 : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
