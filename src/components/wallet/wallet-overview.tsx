"use client";

import Link from "next/link";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Landmark,
  Plus,
  TrendingUp,
  Wallet as WalletIcon,
} from "lucide-react";

import { RateNote } from "@/components/shared/notices";
import { StatTile } from "@/components/shared/stat-tile";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";

/**
 * Wallet balance panel plus the two primary money actions.
 */
export function WalletOverview() {
  const { balance } = usePrototypeStore();

  return (
    <section className="space-y-3" aria-label="Wallet balances">
      <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
        <p className="text-xs font-medium text-primary-foreground/70">Available</p>
        <p className="tabular mt-2 text-[2.125rem] font-semibold leading-10 tracking-tight">
          {formatUsdt(balance.available)}
        </p>
        <p className="tabular mt-1 text-sm text-primary-foreground/70">
          {formatUsdtAsInr(balance.available)} INR
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          href="/wallet/deposit"
          className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-brand px-3 text-sm font-semibold text-brand-foreground transition-colors hover:bg-brand/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus className="size-4" aria-hidden />
          Add Funds
        </Link>
        <Link
          href="/wallet/withdraw"
          className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-border bg-card px-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowDownToLine className="size-4" aria-hidden />
          Withdraw
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile
          label="Total Deposited"
          amount={balance.totalDeposited}
          icon={ArrowUpRight}
        />
        <StatTile
          label="Total Invested"
          amount={balance.totalInvested}
          icon={WalletIcon}
        />
        <StatTile
          label="Total Withdrawn"
          amount={balance.totalWithdrawn}
          icon={Landmark}
        />
        <StatTile
          label="Total Profit"
          amount={balance.totalProfit}
          icon={TrendingUp}
          tone="positive"
        />
      </div>

      <RateNote className="px-1" />
    </section>
  );
}
