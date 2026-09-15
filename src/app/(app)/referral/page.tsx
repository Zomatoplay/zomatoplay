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
import { referralSteps } from "@/data/referrals";
import { generateQrSvg } from "@/lib/qr";
import {
  getUnreadNotificationCount,
  getUserSlices,
} from "@/server/services/account.service";
import {
  SectionBoundary,
  deferred,
} from "@/components/shared/section-boundary";
import { ListSkeleton } from "@/components/shared/page-skeleton";
import { getVipLevels } from "@/server/services/catalogue.service";
import {
  getCommissionHistory,
  getReferralSummary,
  getReferrals,
} from "@/server/services/referrals.service";

export const metadata: Metadata = {
  title: "Referral",
  description:
    "Invite friends to Nanotron, track your referrals and earn commission.",
};

export default async function ReferralPage() {
  /*
   * The activity lists are started here and awaited inside their own boundary.
   *
   * Started here so they ride the same wave as the rest (CLAUDE.md §16.1a item
   * 6); awaited there so a failed commission ledger costs the reader the
   * activity panel rather than the whole referral screen — including the link
   * and QR code they most likely came for.
   *
   * The summary, profile and VIP levels stay on the critical path: the stat
   * tiles and the level card are the primary reading here, and a referral page
   * that silently drops its earnings figure is worse than one that errors.
   */
  const referrals = deferred(getReferrals());
  const commissions = deferred(getCommissionHistory());

  const [{ profile }, summary, vipLevels] = await Promise.all([
    // `profile` and the unread count are for `TopBar` — see the note in the
    // other sections: a component in the returned tree reads a round trip too
    // late, so its reads are named in the page's own wave.
    getUserSlices(["profile"] as const),
    getReferralSummary(),
    getVipLevels(),
    getUnreadNotificationCount(),
  ]);

  const link = `${REFERRAL_BASE_URL}?ref=${profile.referralCode}`;
  const qrSvg = await generateQrSvg(link);
  const level = vipLevels.find((vip) => vip.id === summary.currentLevel);

  return (
    <>
      <TopBar eyebrow="Invite and earn" title="Referral" />

      <PageContainer className="space-y-6">
        <section className="space-y-3" aria-label="Referral summary">
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
          code={profile.referralCode}
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
            levels={vipLevels}
            currentLevel={summary.currentLevel}
            summary={summary}
          />
        </section>

        <section className="space-y-3">
          <SectionHeader title="Referral activity" />
          <SectionBoundary
            title="Referral activity"
            fallback={<ListSkeleton rows={4} />}
          >
            <ReferralActivitySection
              referrals={referrals}
              commissions={commissions}
            />
          </SectionBoundary>
        </section>
      </PageContainer>
    </>
  );
}

/**
 * Awaits the activity reads inside the boundary above. Takes promises rather
 * than data so they start in the page's own wave.
 */
async function ReferralActivitySection({
  referrals,
  commissions,
}: {
  referrals: ReturnType<typeof getReferrals>;
  commissions: ReturnType<typeof getCommissionHistory>;
}) {
  const [list, ledger] = await Promise.all([referrals, commissions]);
  return <ReferralActivity referrals={list} commissions={ledger} />;
}
