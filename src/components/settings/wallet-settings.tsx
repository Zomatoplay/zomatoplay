"use client";

import { useState } from "react";
import { Building2, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "@/components/shared/copy-field";
import { PrototypeNote } from "@/components/shared/notices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { depositNetworks } from "@/data/transactions";
import { savedBankAccounts, savedWalletAddresses } from "@/data/user";
import { cn } from "@/lib/utils";
import { truncateMiddle } from "@/utils/format";
import type { DepositNetworkId } from "@/types";

/**
 * Saved withdrawal destinations and network preferences.
 */
export function WalletSettings() {
  const [defaultNetwork, setDefaultNetwork] = useState<DepositNetworkId>("trc20");
  const [confirmWithdrawals, setConfirmWithdrawals] = useState(true);
  const [whitelistOnly, setWhitelistOnly] = useState(true);

  function notImplemented(what: string) {
    toast(`${what} is not part of this build`, {
      description: "The control is here to show where it will live.",
    });
  }

  return (
    <div className="space-y-6">
      {/* Wallet addresses */}
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Saved wallet addresses
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {savedWalletAddresses.map((address) => (
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
        <Button
          variant="outline"
          size="sm"
          block
          onClick={() => notImplemented("Adding a wallet address")}
        >
          <Plus className="size-4" />
          Add wallet address
        </Button>
      </section>

      {/* Bank accounts */}
      <section id="banks" className="space-y-2 scroll-mt-20">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Bank accounts (INR payouts)
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {savedBankAccounts.map((account) => (
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
        <Button
          variant="outline"
          size="sm"
          block
          onClick={() => notImplemented("Adding a bank account")}
        >
          <Plus className="size-4" />
          Add bank account
        </Button>
      </section>

      {/* Network preference */}
      <section id="preferences" className="space-y-2 scroll-mt-20">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Default deposit network
        </h2>
        <div className="space-y-2">
          {depositNetworks.map((network) => {
            const selected = network.id === defaultNetwork;
            return (
              <label
                key={network.id}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-2xl border p-4 transition-colors",
                  "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring",
                  selected
                    ? "border-brand bg-brand-soft"
                    : "border-border bg-card hover:bg-secondary/50",
                )}
              >
                <input
                  type="radio"
                  name="default-network"
                  value={network.id}
                  checked={selected}
                  onChange={() => setDefaultNetwork(network.id)}
                  className="sr-only"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {network.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {network.chain} · {network.networkFeeNote}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    selected ? "border-brand bg-brand" : "border-border",
                  )}
                >
                  {selected ? (
                    <span className="size-1.5 rounded-full bg-brand-foreground" />
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Withdrawal security */}
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Withdrawal security
        </h2>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex min-h-14 items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Confirm every withdrawal by email
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Requires a link from your inbox before a payout is released.
              </p>
            </div>
            <Switch
              checked={confirmWithdrawals}
              onCheckedChange={setConfirmWithdrawals}
              aria-label="Confirm every withdrawal by email"
            />
          </div>
          <div className="flex min-h-14 items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                Whitelisted destinations only
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Payouts can only go to accounts saved above.
              </p>
            </div>
            <Switch
              checked={whitelistOnly}
              onCheckedChange={setWhitelistOnly}
              aria-label="Whitelisted destinations only"
            />
          </div>
        </div>
      </section>

      <PrototypeNote>
        Demo build — saved destinations are sample data and these preferences are
        not persisted.
      </PrototypeNote>
    </div>
  );
}
