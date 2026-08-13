import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { TopBar } from "@/components/navigation/top-bar";
import { SectionHeader } from "@/components/shared/section-header";
import { EarningsBreakdown } from "@/components/wallet/earnings-breakdown";
import { TransactionBrowser } from "@/components/wallet/transaction-browser";
import { WalletOverview } from "@/components/wallet/wallet-overview";
import { earningsSummary } from "@/data/investments";

export const metadata: Metadata = {
  title: "Wallet",
  description:
    "Balances, deposits, withdrawals, earnings and transaction history.",
};

export default function WalletPage() {
  return (
    <>
      <TopBar eyebrow="Your funds" title="Wallet" />

      <PageContainer className="space-y-6">
        <WalletOverview />

        <section className="space-y-3">
          <SectionHeader title="Earnings" />
          <EarningsBreakdown earnings={earningsSummary} />
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
  );
}
