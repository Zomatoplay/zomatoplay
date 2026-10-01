import { Check, Crown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { ReferralSummary, VipLevel, VipLevelId } from "@/types";

/**
 * VIP tiers. Percentages and thresholds are read from the catalogue rather
 * than restated here, so a config change reaches both applications at once.
 */
export function VipLevels({
  levels,
  currentLevel,
  summary,
  className,
}: {
  levels: VipLevel[];
  currentLevel: VipLevelId;
  summary: ReferralSummary;
  className?: string;
}) {
  const currentIndex = levels.findIndex((level) => level.id === currentLevel);
  const nextLevel = levels[currentIndex + 1] ?? null;

  return (
    <div className={cn("space-y-3", className)}>
      {nextLevel && summary.nextLevelProgress !== null ? (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Progress to {nextLevel.name}</p>
            <span className="tabular text-sm font-semibold text-brand">
              {summary.nextLevelProgress}%
            </span>
          </div>
          <Progress
            value={summary.nextLevelProgress}
            className="mt-3"
            aria-label={`Progress to ${nextLevel.name}`}
          />
          <p className="tabular mt-2 text-xs leading-relaxed text-muted-foreground">
            {summary.activeReferrals}/{nextLevel.requirements.activeReferrals}{" "}
            active referrals ·{" "}
            {formatUsdt(summary.teamVolume, { withSymbol: false, compact: true })}/
            {formatUsdt(nextLevel.requirements.teamVolumeUsdt, {
              withSymbol: false,
              compact: true,
            })}{" "}
            team volume
          </p>
        </div>
      ) : null}

      {levels.map((level, index) => {
        const isCurrent = level.id === currentLevel;
        const isUnlocked = index <= currentIndex;

        return (
          <article
            key={level.id}
            className={cn(
              "rounded-2xl border p-5",
              isCurrent ? "border-brand bg-brand-soft" : "border-border bg-card",
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    isUnlocked
                      ? "bg-brand/15 text-brand"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  <Crown className="size-4" aria-hidden />
                </span>
                <div>
                  <h3 className="text-base font-semibold tracking-tight">
                    {level.name}
                  </h3>
                  <p className="tabular text-xs text-muted-foreground">
                    {level.tier1CommissionPercent}% tier 1 ·{" "}
                    {level.tier2CommissionPercent}% tier 2
                  </p>
                </div>
              </div>
              {isCurrent ? (
                <Badge variant="brand" className="shrink-0">
                  Current
                </Badge>
              ) : isUnlocked ? (
                <Badge variant="outline" className="shrink-0">
                  Unlocked
                </Badge>
              ) : null}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4">
              <div className="min-w-0">
                <dt className="text-[11px] font-medium text-muted-foreground">
                  Active referrals
                </dt>
                <dd className="tabular mt-0.5 text-sm font-semibold">
                  {level.requirements.activeReferrals === 0
                    ? "None required"
                    : `${level.requirements.activeReferrals}+`}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[11px] font-medium text-muted-foreground">
                  Team volume
                </dt>
                <dd className="tabular mt-0.5 text-sm font-semibold">
                  {level.requirements.teamVolumeUsdt === 0
                    ? "None required"
                    : formatUsdt(level.requirements.teamVolumeUsdt, {
                        withSymbol: false,
                        compact: true,
                      })}
                </dd>
              </div>
            </dl>

            <ul className="mt-4 space-y-2">
              {level.benefits.map((benefit) => (
                <li key={benefit} className="flex items-start gap-2">
                  <Check
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0",
                      isUnlocked ? "text-brand" : "text-muted-foreground",
                    )}
                    aria-hidden
                  />
                  <span className="text-xs leading-relaxed text-muted-foreground">
                    {benefit}
                  </span>
                </li>
              ))}
            </ul>
          </article>
        );
      })}

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Commission rates and level requirements are subject to change.
      </p>
    </div>
  );
}
