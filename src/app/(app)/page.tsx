import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";
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
import { getEarningsSummary } from "@/server/services/earnings.service";

export default async function HomePage() {
  // One wave, not three: these are independent reads and awaiting them in
  // sequence would add a round trip each.
  /*
   * `notifications` and `profile` are read here for `TopBar`, not for this page.
   *
   * `TopBar` is an async server component in the tree this page *returns*, so
   * its own reads cannot begin until this function has already resolved — a
   * whole extra round trip (~400ms) tacked onto the end of every one of the
   * five primary sections. Naming the slices here puts them in the same wave as
   * everything else; the reads are request-memoised, so `TopBar` awaiting them
   * a moment later costs nothing.
   */
  const [earnings, slices] = await Promise.all([
    getEarningsSummary(),
    getUserSlices([
      "profile",
      "balance",
      "investments",
      "transactions",
      "notifications",
    ] as const),
  ]);
  const firstName = slices.profile.fullName.split(" ")[0];

  return (
    <UserDataProvider data={slices}>
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
            <EarningsCard earnings={earnings} />
          </section>

          <RecentActivityLive />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
