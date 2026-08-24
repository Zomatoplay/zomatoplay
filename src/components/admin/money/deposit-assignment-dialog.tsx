"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import { Input } from "@/components/ui/input";
import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { truncateMiddle } from "@/utils/format";
import type { AdminDeposit, AdminUser } from "@/types/admin";

/**
 * Attributing an incoming transfer to an account.
 *
 * This is the step that cannot be automated. One platform address receives
 * every deposit and a TRC-20 transfer carries no account identifier, so an
 * operator decides — and the dialog is built to make that decision an informed
 * one rather than a click: it shows the sender address the funds came from, and
 * requires the operator to search for and pick a specific account rather than
 * offering a default.
 *
 * There is no "best match" suggestion on purpose. A plausible-looking
 * suggestion is the thing most likely to be accepted without checking, and
 * crediting the wrong account is not a display bug.
 */
export function DepositAssignmentDialog({
  deposit,
  users,
  open,
  onOpenChange,
  onConfirm,
}: {
  deposit: AdminDeposit | null;
  users: AdminUser[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (userId: string, note: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users.slice(0, 8);
    return users
      .filter((user) =>
        [user.fullName, user.email, user.displayId, user.walletAddress]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 8);
  }, [users, query]);

  const chosen = users.find((user) => user.id === selected) ?? null;

  function reset(next: boolean) {
    if (!next) {
      setQuery("");
      setSelected(null);
    }
    onOpenChange(next);
  }

  return (
    <ConfirmActionDialog
      open={open}
      onOpenChange={reset}
      title="Assign this deposit to a user?"
      description={
        deposit ? (
          <>
            <strong className="font-medium text-foreground">
              {formatUsdt(deposit.amountUsdt)}
            </strong>{" "}
            will be credited to the selected account&rsquo;s available balance,
            and a ledger entry citing this transaction will be written. This
            cannot be undone from here.
          </>
        ) : null
      }
      confirmLabel={chosen ? `Credit ${chosen.fullName}` : "Select a user"}
      reason={{
        label: "Note",
        placeholder: "How was this attributed? e.g. user confirmed the sending address",
      }}
      onConfirm={(note) => {
        if (!selected) return;
        onConfirm(selected, note);
        reset(false);
      }}
    >
      {deposit ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-border bg-secondary/40 p-3 text-xs">
            <dt className="text-muted-foreground">Sent from</dt>
            <dd className="font-mono text-foreground">
              {deposit.senderAddress
                ? truncateMiddle(deposit.senderAddress, 10, 8)
                : "unknown"}
            </dd>
            <dt className="text-muted-foreground">Transaction</dt>
            <dd className="font-mono text-foreground">
              {truncateMiddle(deposit.txHash, 10, 8)}
            </dd>
          </dl>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            The sending address is not proof of identity — exchanges pay out from
            shared wallets. Confirm with the user before crediting.
          </p>

          <div className="space-y-2">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, email or member ID"
                aria-label="Search for a user"
                className="pl-9"
              />
            </div>

            <ul className="max-h-56 space-y-1 overflow-y-auto">
              {matches.length === 0 ? (
                <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No accounts match that search.
                </li>
              ) : (
                matches.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(user.id)}
                      aria-pressed={selected === user.id}
                      className={cn(
                        "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        selected === user.id
                          ? "border-brand bg-brand-soft"
                          : "border-border hover:bg-secondary",
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {user.fullName}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {user.displayId} · {user.email}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-xs text-muted-foreground">
                        {formatUsdt(user.totals.availableUsdt, { withSymbol: false })}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </div>
      ) : null}
    </ConfirmActionDialog>
  );
}
