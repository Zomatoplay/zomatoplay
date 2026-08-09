"use client";

import { useState } from "react";
import { Receipt } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { TransactionItem } from "@/components/shared/transaction-item";
import { usePrototypeStore } from "@/lib/prototype-store";
import { cn } from "@/lib/utils";
import type { TransactionType } from "@/types";

type Filter = "all" | TransactionType;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "deposit", label: "Deposits" },
  { id: "withdrawal", label: "Withdrawals" },
  { id: "investment", label: "Investments" },
  { id: "reward", label: "Rewards" },
  { id: "referral", label: "Referral" },
];

/**
 * Transaction history with type filters.
 *
 * Rendered as a stacked list rather than a table: at 360px a table would
 * either overflow horizontally or truncate every column.
 */
export function TransactionBrowser({ limit }: { limit?: number }) {
  const { transactions } = usePrototypeStore();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered =
    filter === "all"
      ? transactions
      : transactions.filter((transaction) => transaction.type === filter);
  const visible = limit ? filtered.slice(0, limit) : filtered;

  return (
    <div className="space-y-4">
      <div
        className="no-scrollbar edge-scroll -mx-4 overflow-x-auto px-4"
        role="group"
        aria-label="Filter transactions by type"
      >
        <div className="flex w-max gap-2">
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={active}
                className={cn(
                  "h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {visible.length > 0 ? (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {visible.map((transaction) => (
            <li key={transaction.id}>
              <TransactionItem transaction={transaction} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Receipt}
          title="No transactions"
          description="Nothing matches this filter yet."
        />
      )}
    </div>
  );
}
