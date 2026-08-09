import { riskLabels } from "@/data/plans";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";

const level: Record<RiskLevel, number> = {
  conservative: 1,
  balanced: 2,
  growth: 3,
};

const tone: Record<RiskLevel, string> = {
  conservative: "bg-positive",
  balanced: "bg-warning",
  growth: "bg-destructive",
};

/**
 * Three-step risk meter. Risk is encoded by filled-step count *and* label, not
 * by colour alone.
 */
export function RiskIndicator({
  risk,
  className,
  showLabel = true,
}: {
  risk: RiskLevel;
  className?: string;
  showLabel?: boolean;
}) {
  const filled = level[risk];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`Risk: ${riskLabels[risk]}, ${filled} of 3`}
      >
        {[1, 2, 3].map((step) => (
          <span
            key={step}
            className={cn(
              "h-1.5 w-3 rounded-full",
              step <= filled ? tone[risk] : "bg-border",
            )}
          />
        ))}
      </span>
      {showLabel ? (
        <span className="text-xs font-medium text-muted-foreground">
          {riskLabels[risk]}
        </span>
      ) : null}
    </span>
  );
}
