"use client";

import { useState } from "react";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { initials, formatDate } from "@/utils/format";
import type { CommissionEntry, Referral } from "@/types";

/**
 * Referred users and commission history, as two tabs of one stacked list.
 */
export function ReferralActivity({
  referrals,
  commissions,
}: {
  referrals: Referral[];
  commissions: CommissionEntry[];
}) {
  const [tab, setTab] = useState("people");

  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList>
        <TabsTrigger value="people">Referrals</TabsTrigger>
        <TabsTrigger value="commissions">Commission</TabsTrigger>
      </TabsList>

      <TabsContent value="people">
        {referrals.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {referrals.map((referral) => (
              <li key={referral.id} className="flex items-start gap-3 px-4 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold text-foreground">
                  {initials(referral.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {referral.name}
                    </p>
                    <p className="tabular shrink-0 text-sm font-semibold text-positive">
                      {formatUsdt(referral.earnedFromReferral, {
                        withSymbol: false,
                      })}
                    </p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {referral.maskedEmail}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge kind="referral" status={referral.status} />
                    <Badge variant="outline">Tier {referral.tier}</Badge>
                    <span className="tabular text-[11px] text-muted-foreground">
                      Joined {formatDate(referral.joinedDate)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Users}
            title="No referrals yet"
            description="Share your invite link to start building your team."
          />
        )}
      </TabsContent>

      <TabsContent value="commissions">
        {commissions.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {commissions.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-medium text-foreground">
                      {entry.referralName}
                    </p>
                    <p className="tabular shrink-0 text-sm font-semibold text-positive">
                      {formatUsdt(entry.amount, { signed: true, withSymbol: false })}
                    </p>
                  </div>
                  <div className="mt-0.5 flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-xs text-muted-foreground">
                      {entry.sourcePlan}
                    </p>
                    <p className="tabular shrink-0 text-xs text-muted-foreground">
                      {formatUsdtAsInr(entry.amount)}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge variant="outline">Tier {entry.tier}</Badge>
                    <span className="tabular text-[11px] text-muted-foreground">
                      {formatDate(entry.date)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Users}
            title="No commission yet"
            description="Commission appears here once a referral makes an allocation."
          />
        )}
      </TabsContent>
    </Tabs>
  );
}
