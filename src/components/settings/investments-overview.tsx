"use client";

import { Gift, Layers } from "lucide-react";

import { InvestmentCard } from "@/components/home/investment-card";
import { EmptyState } from "@/components/shared/empty-state";
import { TransactionItem } from "@/components/shared/transaction-item";
import { formatUsdt } from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";

/**
 * Active investments, matured history and reward history — the three lists
 * linked from Settings → Investments.
 */
export function InvestmentsOverview() {
  const { activeInvestments, completedInvestments, transactions, balance } =
    usePrototypeStore();

  const rewards = transactions.filter(
    (transaction) =>
      transaction.type === "reward" || transaction.type === "referral",
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-medium text-muted-foreground">
            Currently allocated
          </p>
          <p className="tabular mt-1 text-base font-semibold">
            {formatUsdt(balance.lockedInInvestments, { withSymbol: false })}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-[11px] font-medium text-muted-foreground">
            Total profit
          </p>
          <p className="tabular mt-1 text-base font-semibold text-positive">
            {formatUsdt(balance.totalProfit, { withSymbol: false })}
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Active investments
        </h2>
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
            description="Allocations you create will appear here."
          />
        )}
      </section>

      <section id="history" className="space-y-3 scroll-mt-20">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Investment history
        </h2>
        {completedInvestments.length > 0 ? (
          <div className="space-y-3">
            {completedInvestments.map((investment) => (
              <InvestmentCard key={investment.id} investment={investment} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Layers}
            title="Nothing matured yet"
            description="Completed investments will be listed here."
          />
        )}
      </section>

      <section id="rewards" className="space-y-3 scroll-mt-20">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Profit & reward history
        </h2>
        {rewards.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {rewards.map((transaction) => (
              <li key={transaction.id}>
                <TransactionItem transaction={transaction} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Gift}
            title="No rewards yet"
            description="Rewards credited to your balance will be listed here."
          />
        )}
      </section>
    </div>
  );
}
