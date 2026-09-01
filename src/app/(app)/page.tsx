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
import {
  SectionBoundary,
  deferred,
} from "@/components/shared/section-boundary";
import { CardSkeleton } from "@/components/shared/page-skeleton";
import { getEarningsSummary } from "@/server/services/earnings.service";

export default async function HomePage() {
  /*
   * One wave, not several: these are independent reads and awaiting them in
   * sequence would add a round trip each.
   *
   * `notifications` and `profile` are read here for `TopBar`, not for this page.
   *
   * `TopBar` is an async server component in the tree this page *returns*, so
   * its own reads cannot begin until this function has already resolved — a
   * whole extra round trip (~400ms) tacked onto the end of every one of the
   * five primary sections. Naming the slices here puts them in the same wave as
   * everything else; the reads are request-memoised, so `TopBar` awaiting them
   * a moment later costs nothing.
   */
  /*
   * The earnings rollup is started here and awaited inside its own boundary.
   *
   * Started here so it rides this wave; awaited there so it can fail alone. It
   * used to sit in this `Promise.all`, which meant a rejected earnings read
   * discarded the balance, the allocations and the activity list with it and
   * rendered the route's error page. Home is the screen someone opens to see
   * their money — the earnings *chart* being unavailable is a smaller loss than
   * the whole screen, and the balance stays on the critical path deliberately
   * because a home page that quietly omits it misinforms.
   *
   * The same shape as `/wallet` and `/referral`; see `SectionBoundary`.
   */
  const earnings = deferred(getEarningsSummary());

  const slices = await getUserSlices([
    "profile",
    "balance",
    "investments",
    "transactions",
    "notifications",
  ] as const);
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
            <SectionBoundary
              title="Earnings overview"
              fallback={<CardSkeleton lines={3} />}
            >
              <EarningsSection earnings={earnings} />
            </SectionBoundary>
          </section>

          <RecentActivityLive />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}

/**
 * Awaits the earnings read inside the boundary above. Takes the promise rather
 * than the data so the read starts in the page's own wave.
 */
async function EarningsSection({
  earnings,
}: {
  earnings: ReturnType<typeof getEarningsSummary>;
}) {
  return <EarningsCard earnings={await earnings} />;
}
