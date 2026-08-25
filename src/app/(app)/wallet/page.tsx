import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { SectionHeader } from "@/components/shared/section-header";
import { EarningsBreakdown } from "@/components/wallet/earnings-breakdown";
import { TransactionBrowser } from "@/components/wallet/transaction-browser";
import { WalletOverview } from "@/components/wallet/wallet-overview";
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
  const [earnings, monthlyHistory, slices] = await Promise.all([
    getEarningsSummary(),
    getMonthlyEarningsHistory(),
    getUserSlices([
      "balance",
      "transactions",
      "profile",
      "notifications",
    ] as const),
  ]);


  return (
    <UserDataProvider data={slices}>
      <>
        <TopBar eyebrow="Your funds" title="Wallet" />

        <PageContainer className="space-y-6">
          <WalletOverview />

          <section className="space-y-3">
            <SectionHeader title="Earnings" />
            <EarningsBreakdown earnings={earnings} monthlyHistory={monthlyHistory} />
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
