import { Info, TriangleAlert } from "lucide-react";

import { getUsdtInrRate } from "@/lib/currency";
import { cn } from "@/lib/utils";

/**
 * Explains where the INR figures come from. Shown wherever INR equivalents are
 * prominent, so the conversion is never mistaken for a live market rate.
 */
export function RateNote({ className }: { className?: string }) {
  const { rate, label } = getUsdtInrRate();
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground",
        className,
      )}
    >
      <Info className="mt-px size-3 shrink-0" aria-hidden />
      <span>
        INR amounts are approximate, converted at 1 USDT = ₹{rate.toFixed(2)}.{" "}
        {label} — not a live market rate.
      </span>
    </p>
  );
}

/**
 * Standing risk reminder used on plan screens and the invest flow.
 */
export function RiskNote({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-border bg-secondary/60 p-3",
        className,
      )}
    >
      <TriangleAlert
        className="mt-0.5 size-4 shrink-0 text-warning"
        aria-hidden
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        {children ??
          "Projected returns are estimates, not guarantees. The value of digital assets can fall as well as rise and your capital is at risk."}
      </p>
    </div>
  );
}

/**
 * Makes the prototype status explicit wherever a screen would otherwise look
 * like it is moving real money.
 */
export function PrototypeNote({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border border-dashed border-border px-3 py-2.5",
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {children ??
          "Demo build — this screen uses sample data and does not move real funds."}
      </p>
    </div>
  );
}
