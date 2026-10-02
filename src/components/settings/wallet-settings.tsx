"use client";

import { Building2, Wallet } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-field";
import {
  AddBankAccountSheet,
  AddWalletAddressSheet,
} from "@/components/settings/destination-sheets";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { truncateMiddle } from "@/utils/format";
import type {
  BankAccount,
  DepositNetwork,
  SavedWalletAddress,
} from "@/types";

/**
 * Saved withdrawal destinations.
 *
 * The destinations are the account's own records and the networks are
 * catalogue content, so both are read server-side and passed in.
 */
export function WalletSettings({
  walletAddresses,
  bankAccounts,
  networks,
}: {
  walletAddresses: SavedWalletAddress[];
  bankAccounts: BankAccount[];
  networks: DepositNetwork[];
}) {
  return (
    <div className="space-y-6">
      {/* Wallet addresses */}
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Saved wallet addresses
        </h2>
        {walletAddresses.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No saved addresses"
            description="Save a USDT address to reuse it later."
          />
        ) : null}
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {walletAddresses.map((address) => (
            <li key={address.id} className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                <Wallet className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {address.label}
                  </p>
                  {address.isDefault ? (
                    <Badge variant="brand">Default</Badge>
                  ) : null}
                  <Badge variant="outline">{address.network.toUpperCase()}</Badge>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                  {truncateMiddle(address.address, 12, 8)}
                </p>
              </div>
              <CopyButton
                value={address.address}
                label="wallet address"
                successMessage="Address copied"
                className="shrink-0"
              />
            </li>
          ))}
        </ul>
        <AddWalletAddressSheet networks={networks} />
      </section>

      {/* Bank accounts */}
      <section id="banks" className="space-y-2 scroll-mt-20">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bank accounts (INR payouts)
        </h2>
        {bankAccounts.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No payout destination"
            description="Add a bank account before requesting a withdrawal."
          />
        ) : null}
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {bankAccounts.map((account) => (
            <li key={account.id} className="flex items-start gap-3 px-4 py-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                <Building2 className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {account.bankName}
                  </p>
                  {account.isDefault ? (
                    <Badge variant="brand">Default</Badge>
                  ) : null}
                </div>
                <p className="tabular mt-0.5 text-xs text-muted-foreground">
                  {account.accountNumberMasked} · {account.ifsc}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {account.holderName}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <AddBankAccountSheet />
      </section>
    </div>
  );
}
