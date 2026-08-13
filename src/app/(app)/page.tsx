import { AddFundsCard } from "@/components/home/balance-card";
import { EarningsCard } from "@/components/home/earnings-card";
import {
  AccountSummaryLive,
  ActiveInvestmentsLive,
  KycBannerLive,
  RecentActivityLive,
} from "@/components/home/home-sections";
import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { SectionHeader } from "@/components/shared/section-header";
import { earningsSummary } from "@/data/investments";
import { currentUser } from "@/data/user";

export default function HomePage() {
  const firstName = currentUser.fullName.split(" ")[0];

  return (
    <>
      <TopBar eyebrow="Welcome back" title={firstName} />

      <PageContainer className="space-y-6">
        {/* KYC reminder sits above balances and investments, as specified. */}
        <KycBannerLive />

        <AccountSummaryLive />

        <AddFundsCard />

        <ActiveInvestmentsLive />

        <section className="space-y-3">
          <SectionHeader title="Earnings overview" />
          <EarningsCard earnings={earningsSummary} />
        </section>

        <RecentActivityLive />
      </PageContainer>
    </>
  );
}
