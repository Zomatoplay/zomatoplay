import { Suspense } from "react";
import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { SectionBoundary } from "@/components/shared/section-boundary";
import {
  BalanceSkeleton,
  CardSkeleton,
  ListSkeleton,
} from "@/components/shared/page-skeleton";
import { TopBar } from "@/components/navigation/top-bar";
import { SectionHeader } from "@/components/shared/section-header";
import { EarningsBreakdown } from "@/components/wallet/earnings-breakdown";
import { TransactionBrowser } from "@/components/wallet/transaction-browser";
import { DepositConfirmation } from "@/components/wallet/deposit-confirmation";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { getNewDepositsAction } from "@/app/(app)/wallet/deposit/actions";
import {
  getEarningsSummary,
  getMonthlyEarningsHistory,
} from "@/server/services/earnings.service";

export const metadata: Metadata = {
  title: "Wallet",
  description:
    "Balances, deposits, withdrawals, earnings and transaction history.",
};

/**
 * The wallet's structure renders immediately; every figure on it waits.
 *
 * WHAT IS AND IS NOT ALLOWED TO BE LATE HERE
 * ------------------------------------------
 * The balance stays absent until it is real. The existing rule — "a wallet
 * that quietly omits its balance misinforms rather than degrades" — is about
 * never showing a *wrong* number, and a skeleton is not a number. What the
 * rule does not require, and what used to happen, is holding back the section
 * headings, the deposit/withdraw affordances and the transaction panel until
 * the balance has been read. Measured before the change: the static
 * "Transactions" heading reached the browser at ~1,950ms.
 *
 * So the frame is immediate and each figure arrives in its own boundary. No
 * placeholder anywhere renders a zero, a currency amount or a count.
 */
export default function WalletPage() {
  return (
    <>
      <TopBar eyebrow="Your funds" title="Wallet" />

      <PageContainer className="space-y-6">
        <Suspense fallback={null}>
          <DepositConfirmationSection />
        </Suspense>

        <Suspense fallback={<BalanceSkeleton />}>
          <WalletOverviewSection />
        </Suspense>

        <section className="space-y-3">
          <SectionHeader title="Earnings" />
          <SectionBoundary title="Earnings" fallback={<CardSkeleton lines={3} />}>
            <EarningsSection />
          </SectionBoundary>
        </section>

        <section className="space-y-3">
          <SectionHeader
            title="Transactions"
            action={{ label: "See all", href: "/wallet/transactions" }}
          />
          <SectionBoundary
            title="Transactions"
            fallback={<ListSkeleton rows={4} />}
          >
            <TransactionsSection />
          </SectionBoundary>
        </section>
      </PageContainer>
    </>
  );
}

/**
 * The hero balance.
 *
 * Its own boundary, so the rest of the wallet is readable while the one
 * figure people came for is still being read.
 */
async function WalletOverviewSection() {
  const slices = await getUserSlices(["balance", "profile"] as const);
  return (
    <UserDataProvider data={slices}>
      <WalletOverview />
    </UserDataProvider>
  );
}

/**
 * The recent ledger.
 *
 * Read separately from the balance so neither waits for the other; both are
 * request-memoised, so a slice used by two boundaries is still one query.
 */
async function TransactionsSection() {
  const slices = await getUserSlices(["transactions", "balance"] as const);
  return (
    <UserDataProvider data={slices}>
      <TransactionBrowser limit={6} />
    </UserDataProvider>
  );
}

/**
 * "Your deposit arrived."
 *
 * Renders nothing at all until it has a credited, unacknowledged deposit to
 * report, so a `null` fallback is the honest placeholder — there is no shape
 * to hold. Here as well as on `/wallet/deposit` because a deposit credited by
 * the scanner while nobody was on that screen is found by whichever screen is
 * opened next (CLAUDE.md §18.4a).
 */
async function DepositConfirmationSection() {
  const newDeposits = await getNewDepositsAction();
  return (
    <DepositConfirmation
      deposits={newDeposits.deposits}
      availableUsdt={newDeposits.availableUsdt}
    />
  );
}

/**
 * The earnings rollup. One memoised query serves both shapes it renders.
 */
async function EarningsSection() {
  const [summary, history] = await Promise.all([
    getEarningsSummary(),
    getMonthlyEarningsHistory(),
  ]);
  return <EarningsBreakdown earnings={summary} monthlyHistory={history} />;
}

