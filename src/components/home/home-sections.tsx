"use client";

import Link from "next/link";
import { Layers, Receipt, TrendingUp, Wallet } from "lucide-react";

import { BalanceCard } from "@/components/home/balance-card";
import { InvestmentCard } from "@/components/home/investment-card";
import { KycBanner } from "@/components/home/kyc-banner";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionHeader } from "@/components/shared/section-header";
import { StatTile } from "@/components/shared/stat-tile";
import { TransactionList } from "@/components/shared/transaction-item";
import { Button } from "@/components/ui/button";
import { usePrototypeStore } from "@/lib/prototype-store";

/**
 * Container components for Home.
 *
 * These are the only client components on the page: they read the mutable
 * account state and hand it to presentational components. Everything else on
 * Home stays a server component.
 */

export function KycBannerLive() {
  const { kycStatus } = usePrototypeStore();
  return <KycBanner status={kycStatus} />;
}

export function AccountSummaryLive() {
  const { balance, activeInvestments } = usePrototypeStore();

  return (
    <section className="space-y-3" aria-label="Account summary">
      <BalanceCard available={balance.available} />

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Total Invested"
          amount={balance.totalInvested}
          icon={Wallet}
        />
        <StatTile
          label="Total Profit"
          amount={balance.totalProfit}
          icon={TrendingUp}
          tone="positive"
        />
        <StatTile
          label="Active Investments"
          value={String(activeInvestments.length)}
          icon={Layers}
          hint="Across all plans"
        />
        <StatTile
          label="Locked in plans"
          amount={balance.lockedInInvestments}
          icon={Layers}
        />
      </div>

    </section>
  );
}

export function ActiveInvestmentsLive() {
  const { activeInvestments } = usePrototypeStore();

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Your investments"
        description={
          activeInvestments.length > 0
            ? `${activeInvestments.length} active`
            : undefined
        }
        action={{ label: "See all", href: "/settings/investments" }}
      />
      {activeInvestments.length > 0 ? (
        <div className="space-y-3">
          {activeInvestments.map((investment) => (
            <InvestmentCard key={investment.id} investment={investment} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Layers}
          title="No active investments"
          description="Browse the available plans to put your balance to work."
          action={
            <Button asChild size="sm" variant="brand">
              <Link href="/plans">Explore plans</Link>
            </Button>
          }
        />
      )}
    </section>
  );
}

export function RecentActivityLive() {
  const { transactions } = usePrototypeStore();
  const recent = transactions.slice(0, 5);

  return (
    <section className="space-y-3">
      <SectionHeader
        title="Recent activity"
        action={{ label: "See all", href: "/wallet/transactions" }}
      />
      {recent.length > 0 ? (
        <TransactionList transactions={recent} />
      ) : (
        <EmptyState
          icon={Receipt}
          title="Nothing here yet"
          description="Your deposits, investments and rewards will appear here."
        />
      )}
    </section>
  );
}
