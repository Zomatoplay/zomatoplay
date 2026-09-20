import { Suspense } from "react";

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
import { SectionBoundary } from "@/components/shared/section-boundary";
import {
  BalanceSkeleton,
  CardSkeleton,
  ListSkeleton,
} from "@/components/shared/page-skeleton";
import { getEarningsSummary } from "@/server/services/earnings.service";

/**
 * Home renders its frame immediately; every figure on it arrives after.
 *
 * This screen is the one someone opens to see their money, and the rule that
 * governs it is unchanged: nothing here may render a placeholder balance, a
 * placeholder allocation or a fabricated verification state. What changed is
 * that the *frame* — the greeting, the section headings, the add-funds
 * affordance — no longer waits for four slices and an earnings rollup before
 * any of it exists. Measured before the change: the static "Earnings
 * overview" heading reached the browser at ~1,440ms.
 *
 * Each block below is read and awaited inside its own boundary, so a slow
 * ledger does not hold up the balance and vice versa. Every read is
 * request-memoised, so slices shared between blocks are still one query each.
 */
export default function HomePage() {
  return (
    <>
      <Suspense fallback={<TopBar eyebrow="Welcome back" title="Your account" />}>
        <HomeTopBar />
      </Suspense>

      <PageContainer className="space-y-6">
        {/* KYC reminder sits above balances and investments, as specified. */}
        <SectionBoundary title="Verification" fallback={null}>
          <KycBannerSection />
        </SectionBoundary>

        <SectionBoundary title="Account summary" fallback={<BalanceSkeleton />}>
          <AccountSummarySection />
        </SectionBoundary>

        <AddFundsCard />

        <SectionBoundary
          title="Your investments"
          fallback={<ListSkeleton rows={2} />}
        >
          <ActiveInvestmentsSection />
        </SectionBoundary>

        <section className="space-y-3">
          <SectionHeader title="Earnings overview" />
          <SectionBoundary
            title="Earnings overview"
            fallback={<CardSkeleton lines={3} />}
          >
            <EarningsSection />
          </SectionBoundary>
        </section>

        <SectionBoundary
          title="Recent activity"
          fallback={<ListSkeleton rows={4} />}
        >
          <RecentActivitySection />
        </SectionBoundary>
      </PageContainer>
    </>
  );
}

/**
 * The greeting carries the account's first name, so it waits.
 *
 * Its fallback is the same bar with a neutral title rather than a blank
 * space: the header's height and its controls are known, only the name is
 * not.
 */
async function HomeTopBar() {
  const { profile } = await getUserSlices(["profile"] as const);
  return <TopBar eyebrow="Welcome back" title={profile.fullName.split(" ")[0]} />;
}

async function KycBannerSection() {
  const slices = await getUserSlices(["profile"] as const);
  return (
    <UserDataProvider data={slices}>
      <KycBannerLive />
    </UserDataProvider>
  );
}

async function AccountSummarySection() {
  const slices = await getUserSlices(["balance", "investments"] as const);
  return (
    <UserDataProvider data={slices}>
      <AccountSummaryLive />
    </UserDataProvider>
  );
}

async function ActiveInvestmentsSection() {
  const slices = await getUserSlices(["investments"] as const);
  return (
    <UserDataProvider data={slices}>
      <ActiveInvestmentsLive />
    </UserDataProvider>
  );
}

async function RecentActivitySection() {
  const slices = await getUserSlices(["transactions"] as const);
  return (
    <UserDataProvider data={slices}>
      <RecentActivityLive />
    </UserDataProvider>
  );
}

/** The earnings curve. */
async function EarningsSection() {
  return <EarningsCard earnings={await getEarningsSummary()} />;
}
