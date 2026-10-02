import type { LucideIcon } from "lucide-react";

import { CurrencyDisplay } from "@/components/shared/currency-display";
import { cn } from "@/lib/utils";

interface StatTileProps {
  label: string;
  /** USDT amount. Omit and pass `value` for non-monetary stats. */
  amount?: number;
  /** Non-monetary display value (counts, levels). */
  value?: string;
  icon?: LucideIcon;
  hint?: string;
  tone?: "default" | "positive";
  hideInr?: boolean;
  className?: string;
}

/**
 * Small labelled figure used in the 2-up summary grids on Home and Wallet.
 * Kept deliberately compact so two tiles fit on a 360px screen.
 */
export function StatTile({
  label,
  amount,
  value,
  icon: Icon,
  hint,
  tone = "default",
  hideInr = true,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex items-start gap-1.5 text-muted-foreground">
        {Icon ? <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : null}
        {/* Wraps rather than truncates: at 360px a two-column tile is only
            ~150px wide and labels like "Active Investments" do not fit. */}
        <span className="min-w-0 text-xs font-medium leading-tight">{label}</span>
      </div>
      {amount !== undefined ? (
        <CurrencyDisplay
          amount={amount}
          size="sm"
          tone={tone === "positive" ? "positive" : "default"}
          hideInr={hideInr}
          hideSymbol
        />
      ) : (
        <span className="tabular text-base font-semibold tracking-tight text-foreground">
          {value}
        </span>
      )}
      {hint ? (
        <span className="text-[11px] leading-tight text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}
