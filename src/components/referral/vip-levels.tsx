import { Crown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Referral, VipLevel } from "@/types";

/**
 * VIP levels by referral DEPTH, from this account's point of view.
 *
 * A person you referred is VIP 1; someone they referred is VIP 2; one level
 * further is VIP 3, and so on. It never depends on how many people anyone
 * referred or how much they invested — 500 direct referrals are 500 × VIP 1.
 *
 * Commission is unchanged: it is paid on VIP 1 and VIP 2 allocations at the
 * two rates the programme defines (`vip_levels`, joined on this account), and
 * deeper levels earn none — there is no third commission rate, and none is
 * shown.
 */
export function VipLevels({
  referrals,
  commissionLevel,
  className,
}: {
  referrals: Referral[];
  /** The programme row that sets this account's two commission rates. */
  commissionLevel: VipLevel | undefined;
  className?: string;
}) {
  const counts = new Map<number, number>();
  for (const referral of referrals) {
    counts.set(referral.depth, (counts.get(referral.depth) ?? 0) + 1);
  }
  const deepest = Math.max(3, ...counts.keys());
  const levels = Array.from({ length: deepest }, (_, index) => index + 1);

  function commissionFor(depth: number): string {
    if (!commissionLevel) return "—";
    if (depth === 1) return `${commissionLevel.tier1CommissionPercent}% commission`;
    if (depth === 2) return `${commissionLevel.tier2CommissionPercent}% commission`;
    return "No commission";
  }

  return (
    <div className={cn("space-y-3", className)}>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {levels.map((depth) => (
          <li key={depth} className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                <Crown className="size-4" aria-hidden />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-semibold tracking-tight">VIP {depth}</h3>
                <p className="text-xs text-muted-foreground">
                  {depth === 1
                    ? "People you referred"
                    : depth === 2
                      ? "Referred by your VIP 1"
                      : `Referred by your VIP ${depth - 1}`}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-border/60 pt-3">
              <span className="tabular text-xl font-semibold">{counts.get(depth) ?? 0}</span>
              <span className="tabular text-xs text-muted-foreground">{commissionFor(depth)}</span>
            </div>
          </li>
        ))}
      </ul>
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        VIP level shows how far someone is from you in your referral network,
        not how many people they referred.
      </p>
    </div>
  );
}
