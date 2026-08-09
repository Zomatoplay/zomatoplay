import type { Metadata } from "next";
import { Crown, TrendingUp, UserCheck, Users } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { ReferralActivity } from "@/components/referral/referral-activity";
import { ReferralLinkCard } from "@/components/referral/referral-link-card";
import { VipLevels } from "@/components/referral/vip-levels";
import { RateNote } from "@/components/shared/notices";
import { SectionHeader } from "@/components/shared/section-header";
import { StatTile } from "@/components/shared/stat-tile";
import { REFERRAL_BASE_URL } from "@/constants/app";
import {
  commissionHistory,
  getVipLevel,
  referralSteps,
  referralSummary,
  referrals,
} from "@/data/referrals";
import { currentUser } from "@/data/user";
import { generateQrSvg } from "@/lib/qr";

export const metadata: Metadata = {
  title: "Referral",
  description:
    "Invite friends to Nanotron, track your referrals and earn commission.",
};

export default async function ReferralPage() {
  const link = `${REFERRAL_BASE_URL}/${currentUser.referralCode}`;
  const qrSvg = await generateQrSvg(link);
  const level = getVipLevel(referralSummary.currentLevel);

  return (
    <>
      <TopBar eyebrow="Invite and earn" title="Referral" />

      <PageContainer className="space-y-6">
        <section className="space-y-3" aria-label="Referral summary">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Total Referrals"
              value={String(referralSummary.totalReferrals)}
              icon={Users}
            />
            <StatTile
              label="Active Referrals"
              value={String(referralSummary.activeReferrals)}
              icon={UserCheck}
            />
            <StatTile
              label="Referral Earnings"
              amount={referralSummary.totalEarnings}
              icon={TrendingUp}
              tone="positive"
            />
            <StatTile
              label="VIP Level"
              value={level?.name ?? "VIP 1"}
              icon={Crown}
              hint={
                level ? `${level.tier1CommissionPercent}% tier 1 commission` : undefined
              }
            />
          </div>
          <RateNote className="px-1" />
        </section>

        <ReferralLinkCard
          link={link}
          code={currentUser.referralCode}
          qrSvg={qrSvg}
        />

        <section className="space-y-3">
          <SectionHeader title="How referrals work" />
          <ol className="space-y-3 rounded-2xl border border-border bg-card p-5">
            {referralSteps.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3">
                <span className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {step.description}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="VIP levels"
            description="Higher levels earn a larger share of your team's allocations."
          />
          <VipLevels
            currentLevel={referralSummary.currentLevel}
            summary={referralSummary}
          />
        </section>

        <section className="space-y-3">
          <SectionHeader title="Referral activity" />
          <ReferralActivity
            referrals={referrals}
            commissions={commissionHistory}
          />
        </section>
      </PageContainer>
    </>
  );
}
