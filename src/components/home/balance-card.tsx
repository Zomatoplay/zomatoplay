import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, Plus } from "lucide-react";

import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";

interface BalanceCardProps {
  available: number;
  className?: string;
}

/**
 * The hero balance panel on Home.
 *
 * Deep charcoal surface with large, tabular figures — the one place in the app
 * that uses an inverted surface, so the primary number is unmistakable.
 */
export function BalanceCard({ available, className }: BalanceCardProps) {
  return (
    <section
      aria-labelledby="balance-heading"
      className={cn(
        "overflow-hidden rounded-2xl bg-primary text-primary-foreground",
        className,
      )}
    >
      <div className="p-5">
        <h2
          id="balance-heading"
          className="text-xs font-medium text-primary-foreground/70"
        >
          Available Balance
        </h2>
        <p className="tabular mt-2 text-[2.125rem] font-semibold leading-10 tracking-tight">
          {formatUsdt(available)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-px border-t border-primary-foreground/15 bg-primary-foreground/15">
        <Link
          href="/wallet/deposit"
          className="flex min-h-14 items-center justify-center gap-2 bg-primary px-3 text-sm font-medium transition-colors hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-foreground"
        >
          <Plus className="size-4" aria-hidden />
          Add Funds
        </Link>
        <Link
          href="/wallet/withdraw"
          className="flex min-h-14 items-center justify-center gap-2 bg-primary px-3 text-sm font-medium transition-colors hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-foreground"
        >
          <ArrowDownToLine className="size-4" aria-hidden />
          Withdraw
        </Link>
      </div>
    </section>
  );
}

/**
 * Prominent "Add Funds" prompt used where the hero card is not present.
 */
export function AddFundsCard({ className }: { className?: string }) {
  return (
    <Link
      href="/wallet/deposit"
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-secondary/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand">
        <Plus className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">
          Add funds in USDT
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
          Deposit on TRC20, BEP20, Polygon or ERC20. Credited automatically once
          confirmed.
        </span>
      </span>
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
