import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgePlus,
  Gift,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

import { StatusBadge } from "@/components/shared/status-badge";
import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/format";
import type { Transaction, TransactionType } from "@/types";

const typeMeta: Record<TransactionType, { label: string; icon: LucideIcon }> = {
  deposit: { label: "Deposit", icon: ArrowDownLeft },
  withdrawal: { label: "Withdrawal", icon: ArrowUpRight },
  investment: { label: "Investment", icon: TrendingUp },
  reward: { label: "Reward", icon: Gift },
  referral: { label: "Referral", icon: Users },
  adjustment: { label: "Account credit", icon: BadgePlus },
};

/**
 * One ledger entry, laid out as a stacked row rather than a table cell —
 * transaction history has to stay readable at 360px.
 */
export function TransactionItem({
  transaction,
  className,
}: {
  transaction: Transaction;
  className?: string;
}) {
  const meta = typeMeta[transaction.type];
  const Icon = meta.icon;
  const isCredit = transaction.amount >= 0;
  const showConfirmations =
    transaction.type === "deposit" &&
    transaction.confirmations &&
    transaction.confirmations.current < transaction.confirmations.required;

  return (
    <div className={cn("flex items-start gap-3 px-4 py-3.5", className)}>
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          isCredit ? "bg-brand-soft text-brand" : "bg-secondary text-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm font-medium text-foreground">
            {meta.label}
          </p>
          <p
            className={cn(
              "tabular shrink-0 text-sm font-semibold",
              isCredit ? "text-positive" : "text-foreground",
            )}
          >
            {formatUsdt(transaction.amount, { signed: true })}
          </p>
        </div>

        <div className="mt-0.5 flex items-start justify-between gap-3">
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {transaction.description}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusBadge kind="transaction" status={transaction.status} />
          <span className="tabular text-[11px] text-muted-foreground">
            {formatDateTime(transaction.date)}
          </span>
          {showConfirmations && transaction.confirmations ? (
            <span className="tabular text-[11px] text-muted-foreground">
              · {transaction.confirmations.current}/
              {transaction.confirmations.required} confirmations
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Card wrapper that stacks transaction rows with hairline dividers.
 */
export function TransactionList({
  transactions,
  className,
}: {
  transactions: Transaction[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        "divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      {transactions.map((transaction) => (
        <li key={transaction.id}>
          <TransactionItem transaction={transaction} />
        </li>
      ))}
    </ul>
  );
}
