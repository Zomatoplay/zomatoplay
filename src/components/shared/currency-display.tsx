import { cva, type VariantProps } from "class-variance-authority";

import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * The single component every screen uses to render a monetary amount.
 *
 * It always receives a USDT amount and derives the INR equivalent through
 * `@/lib/currency`, so conversion logic exists in exactly one place. When the
 * mock rate is replaced by a live rates API, nothing here changes.
 */

const primaryVariants = cva("tabular font-semibold tracking-tight", {
  variants: {
    size: {
      xs: "text-sm",
      sm: "text-base",
      md: "text-xl",
      lg: "text-[1.75rem] leading-9",
      xl: "text-[2.125rem] leading-10",
    },
    tone: {
      default: "text-foreground",
      positive: "text-positive",
      negative: "text-destructive",
      muted: "text-muted-foreground",
      inverted: "text-primary-foreground",
    },
  },
  defaultVariants: { size: "md", tone: "default" },
});

const secondaryVariants = cva("tabular", {
  variants: {
    size: {
      xs: "text-[11px]",
      sm: "text-xs",
      md: "text-xs",
      lg: "text-sm",
      xl: "text-sm",
    },
    tone: {
      default: "text-muted-foreground",
      positive: "text-muted-foreground",
      negative: "text-muted-foreground",
      muted: "text-muted-foreground",
      inverted: "text-primary-foreground/70",
    },
  },
  defaultVariants: { size: "md", tone: "default" },
});

export interface CurrencyDisplayProps
  extends VariantProps<typeof primaryVariants> {
  /** Amount in USDT. INR is always derived, never passed in. */
  amount: number;
  /** The INR line is off everywhere by default; the rate belongs to the deposit page only. */
  hideInr?: boolean;
  /** Render on a single line as `1,250.00 USDT · ≈ ₹104,000`. */
  inline?: boolean;
  /** Force a leading `+` on positive amounts. */
  signed?: boolean;
  /** Drop the ` USDT` suffix from the primary line. */
  hideSymbol?: boolean;
  /** Use compact notation (e.g. `18.4K`) for the USDT figure. */
  compact?: boolean;
  className?: string;
  /** Optional label rendered above the amount. */
  label?: string;
}

export function CurrencyDisplay({
  amount,
  size,
  tone,
  hideInr = true,
  inline = false,
  signed = false,
  hideSymbol = false,
  compact = false,
  className,
  label,
}: CurrencyDisplayProps) {
  const primary = formatUsdt(amount, {
    signed,
    compact,
    withSymbol: !hideSymbol,
  });
  const secondary = formatUsdtAsInr(Math.abs(amount));

  if (inline) {
    return (
      <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
        <span className={primaryVariants({ size, tone })}>{primary}</span>
        {hideInr ? null : (
          <span className={secondaryVariants({ size, tone })}>{secondary}</span>
        )}
      </span>
    );
  }

  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {label ? (
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      ) : null}
      <span className={primaryVariants({ size, tone })}>{primary}</span>
      {hideInr ? null : (
        <span className={secondaryVariants({ size, tone })}>{secondary}</span>
      )}
    </div>
  );
}

/**
 * INR-only readout, for places where the INR figure is the subject (withdrawal
 * payouts) rather than the approximation.
 */
export function InrAmount({
  usdt,
  className,
  approximate = false,
  precise = true,
}: {
  usdt: number;
  className?: string;
  approximate?: boolean;
  precise?: boolean;
}) {
  return (
    <span className={cn("tabular", className)}>
      {formatUsdtAsInr(usdt, { approximate, precise })}
    </span>
  );
}
