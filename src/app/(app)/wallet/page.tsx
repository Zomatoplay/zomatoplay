import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import {
  SectionBoundary,
  deferred,
} from "@/components/shared/section-boundary";
import { CardSkeleton } from "@/components/shared/page-skeleton";
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

export default async function WalletPage() {
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
  /*
   * The earnings rollup is started here and awaited inside its own boundary.
   *
   * Started here so it rides the same wave as everything else — moving the call
   * into the section component would delay it until React rendered that
   * component, costing an extra round trip (CLAUDE.md §16.1a item 6).
   *
   * Awaited there so it can fail alone. It used to sit in this `Promise.all`,
   * which meant a rejected earnings read discarded the balance and the
   * transaction list too and rendered the route's error page. A wallet whose
   * earnings panel is unavailable is still a wallet; a wallet replaced by
   * "Something went wrong" is not.
   *
   * The balance, transactions and profile stay on the critical path
   * deliberately: they are the reading a person came for, and a wallet that
   * quietly omits its balance misinforms rather than degrades.
   */
  const earnings = deferred(getEarningsSummary());
  const monthlyHistory = deferred(getMonthlyEarningsHistory());

  /*
   * The "deposit confirmed" state, read in this page's own wave.
   *
   * Here as well as on `/wallet/deposit` because a deposit credited by the
   * background scanner is found by whichever screen the person opens next, and
   * the wallet is the likelier one — the deposit screen only polls while it is
   * open (CLAUDE.md §18.5). Nothing is announced twice: both screens read the
   * same `acknowledged_at is null` rows, and dismissing on either clears both.
   *
   * Started alongside the slices rather than awaited after them: two sequential
   * awaits here would be two waves of round trips for reads that share nothing
   * (§16.1a item 6).
   */
  const [slices, newDeposits] = await Promise.all([
    getUserSlices([
      "balance",
      "transactions",
      "profile",
      "notifications",
    ] as const),
    getNewDepositsAction(),
  ]);


  return (
    <UserDataProvider data={slices}>
      <>
        <TopBar eyebrow="Your funds" title="Wallet" />

        <PageContainer className="space-y-6">
          <DepositConfirmation
            deposits={newDeposits.deposits}
            availableUsdt={newDeposits.availableUsdt}
          />

          <WalletOverview />

          <section className="space-y-3">
            <SectionHeader title="Earnings" />
            <SectionBoundary title="Earnings" fallback={<CardSkeleton lines={3} />}>
              <EarningsSection
                earnings={earnings}
                monthlyHistory={monthlyHistory}
              />
            </SectionBoundary>
          </section>

          <section className="space-y-3">
            <SectionHeader
              title="Transactions"
              action={{ label: "See all", href: "/wallet/transactions" }}
            />
            <TransactionBrowser limit={6} />
          </section>
        </PageContainer>
      </>
  </UserDataProvider>
  );
}

/**
 * Awaits the earnings reads inside the boundary above.
 *
 * Takes promises rather than data so the reads start in the page's own wave;
 * see `SectionBoundary` for why that distinction matters here.
 */
async function EarningsSection({
  earnings,
  monthlyHistory,
}: {
  earnings: ReturnType<typeof getEarningsSummary>;
  monthlyHistory: ReturnType<typeof getMonthlyEarningsHistory>;
}) {
  const [summary, history] = await Promise.all([earnings, monthlyHistory]);
  return <EarningsBreakdown earnings={summary} monthlyHistory={history} />;
}
