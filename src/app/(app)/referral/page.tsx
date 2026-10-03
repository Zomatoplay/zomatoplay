import type { Metadata } from "next";
import { Crown, TrendingUp, UserCheck, Users } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { ReferralActivity } from "@/components/referral/referral-activity";
import { ReferralLinkCard } from "@/components/referral/referral-link-card";
import { VipLevels } from "@/components/referral/vip-levels";
import { SectionHeader } from "@/components/shared/section-header";
import { StatTile } from "@/components/shared/stat-tile";
import { APP_NAME, REFERRAL_BASE_URL } from "@/constants/app";
import { referralSteps } from "@/data/referrals";
import { generateQrSvg } from "@/lib/qr";
import { getUserSlices } from "@/server/services/account.service";
import { SectionBoundary } from "@/components/shared/section-boundary";
import {
  CardSkeleton,
  ListSkeleton,
  StatGridSkeleton,
} from "@/components/shared/page-skeleton";
import { getVipLevels } from "@/server/services/catalogue.service";
import {
  getCommissionHistory,
  getReferralSummary,
  getReferrals,
} from "@/server/services/referrals.service";

export const metadata: Metadata = {
  title: "Referral",
  description:
    `Invite friends to ${APP_NAME}, track your referrals and earn commission.`,
};

/**
 * The referral explainer renders immediately; every number and the link wait.
 *
 * "How referrals work" and the VIP section framing are fixed copy and were
 * previously held behind the summary read — measured at ~2,650ms before this
 * change, the slowest structure on any primary route. The stat tiles, the
 * link/QR card and the VIP table each wait in their own boundary now.
 */
export default function ReferralPage() {
  return (
    <>
      <TopBar eyebrow="Invite and earn" title="Referral" />

      <PageContainer className="space-y-6">
        <section className="space-y-3" aria-label="Referral summary">
          <SectionBoundary
            title="Referral summary"
            fallback={<StatGridSkeleton tiles={4} />}
          >
            <ReferralSummarySection />
          </SectionBoundary>
        </section>

        <SectionBoundary
          title="Referral link"
          fallback={<CardSkeleton lines={3} />}
        >
          <ReferralLinkSection />
        </SectionBoundary>

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
            description="Your network by distance from you: people you referred are VIP 1, their referrals VIP 2, and so on."
          />
          <SectionBoundary title="VIP levels" fallback={<ListSkeleton rows={3} />}>
            <VipLevelsSection />
          </SectionBoundary>
        </section>

        <section className="space-y-3">
          <SectionHeader title="Referral activity" />
          <SectionBoundary
            title="Referral activity"
            fallback={<ListSkeleton rows={4} />}
          >
            <ReferralActivitySection />
          </SectionBoundary>
        </section>
      </PageContainer>
    </>
  );
}

/**
 * The four stat tiles.
 *
 * No placeholder tile renders a zero: an account with no referrals and an
 * account whose summary has not loaded must not look the same.
 */
async function ReferralSummarySection() {
  const [summary, vipLevels] = await Promise.all([
    getReferralSummary(),
    getVipLevels(),
  ]);
  const level = vipLevels.find((vip) => vip.id === summary.currentLevel);

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatTile
        label="Total Referrals"
        value={String(summary.totalReferrals)}
        icon={Users}
      />
      <StatTile
        label="Active Referrals"
        value={String(summary.activeReferrals)}
        icon={UserCheck}
      />
      <StatTile
        label="Referral Earnings"
        amount={summary.totalEarnings}
        icon={TrendingUp}
        tone="positive"
      />
      <StatTile
        label="Commission rate"
        value={
          level
            ? `${level.tier1CommissionPercent}% / ${level.tier2CommissionPercent}%`
            : "—"
        }
        icon={Crown}
        hint="On VIP 1 / VIP 2 allocations"
      />
    </div>
  );
}

/**
 * The shareable link and its QR code.
 *
 * The QR is generated from the code, so it cannot start until the profile has
 * been read; keeping it in here means that CPU cost is inside the boundary
 * rather than in front of the whole page, which is where it used to sit.
 */
async function ReferralLinkSection() {
  const { profile } = await getUserSlices(["profile"] as const);
  const link = `${REFERRAL_BASE_URL}?ref=${profile.referralCode}`;
  const qrSvg = await generateQrSvg(link);

  return (
    <ReferralLinkCard link={link} code={profile.referralCode} qrSvg={qrSvg} />
  );
}

/** The network by depth, and the commission each depth earns. */
async function VipLevelsSection() {
  const [summary, vipLevels, network] = await Promise.all([
    getReferralSummary(),
    getVipLevels(),
    getReferrals(),
  ]);
  return (
    <VipLevels
      referrals={network}
      commissionLevel={vipLevels.find((vip) => vip.id === summary.currentLevel)}
    />
  );
}

/** The referral list and the commission ledger. */
async function ReferralActivitySection() {
  const [list, ledger] = await Promise.all([
    getReferrals(),
    getCommissionHistory(),
  ]);
  return <ReferralActivity referrals={list} commissions={ledger} />;
}
