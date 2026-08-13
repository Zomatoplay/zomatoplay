import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { cn } from "@/lib/utils";

interface AdminStatCardProps {
  label: string;
  /** USDT amount. Provide this OR `value`, not both. */
  amount?: number;
  /** Non-monetary display value (counts, percentages). */
  value?: string | number;
  icon?: LucideIcon;
  /** Secondary line under the figure. */
  hint?: string;
  /** Draws attention to a queue that needs work. */
  tone?: "default" | "positive" | "warning" | "negative";
  /** Makes the whole card a link to the relevant queue. */
  href?: string;
  /** Show the INR equivalent under a USDT figure. */
  showInr?: boolean;
  className?: string;
}

const toneStyles = {
  default: "text-foreground",
  positive: "text-positive",
  warning: "text-warning",
  negative: "text-destructive",
} as const;

const iconToneStyles = {
  default: "bg-secondary text-muted-foreground",
  positive: "bg-brand-soft text-brand",
  warning: "bg-warning/12 text-warning",
  negative: "bg-destructive/10 text-destructive",
} as const;

/**
 * Summary figure for the CRM dashboard.
 *
 * A single number is not a chart — these are stat tiles, and the figure is the
 * subject. Values use proportional figures at display size (`tabular` is
 * reserved for columns that must align vertically, i.e. the tables).
 *
 * Monetary figures always go through `@/lib/currency`; no conversion happens
 * here.
 */
export function AdminStatCard({
  label,
  amount,
  value,
  icon: Icon,
  hint,
  tone = "default",
  href,
  showInr = false,
  className,
}: AdminStatCardProps) {
  const display =
    amount !== undefined
      ? // Compact above 10k: at 360px two cards share the row, leaving ~128px
        // for the figure — enough for "74.8K" but not "74,820.00".
        formatUsdt(amount, { withSymbol: false, compact: amount >= 10000 })
      : typeof value === "number"
        ? value.toLocaleString("en-IN")
        : (value ?? "—");

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-xs font-medium leading-tight text-muted-foreground">
          {label}
        </span>
        {Icon ? (
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg",
              iconToneStyles[tone],
            )}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : null}
      </div>

      <div className="mt-2 space-y-0.5">
        <p
          className={cn(
            "break-words text-xl font-semibold leading-tight tracking-tight sm:text-2xl",
            toneStyles[tone],
          )}
        >
          {display}
          {amount !== undefined ? (
            <span className="ml-1 text-xs font-medium text-muted-foreground">
              USDT
            </span>
          ) : null}
        </p>
        {amount !== undefined && showInr ? (
          <p className="tabular text-xs text-muted-foreground">
            {formatUsdtAsInr(amount)}
          </p>
        ) : null}
        {hint ? (
          <p className="text-xs leading-snug text-muted-foreground">{hint}</p>
        ) : null}
      </div>
    </>
  );

  const shared = cn(
    "flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4",
    className,
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          shared,
          "group transition-colors hover:border-brand/40 hover:bg-secondary/40",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        )}
      >
        {body}
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand">
          Open
          <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    );
  }

  return <div className={shared}>{body}</div>;
}

/** Responsive grid the dashboard lays its stat cards out in. */
export function AdminStatGrid({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
