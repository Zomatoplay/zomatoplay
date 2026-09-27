"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { AdminSection } from "@/components/admin/layout/admin-shell";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import {
  DetailCard,
  DetailList,
  DetailRow,
  MonoValue,
} from "@/components/admin/shared/detail-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setDepositAddressAction } from "@/app/admin/actions";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { formatDateTimeUtc } from "@/utils/format";
import type { AdminDepositConfiguration } from "@/types/admin";

/**
 * Network, asset, and the one receiving address — plus who changed it, when.
 *
 * What this screen deliberately is NOT: a pool, an allocator, or a key
 * generator. It stores an address an operator produced with their own wallet
 * tooling; nothing here derives or holds a key (CLAUDE.md §18.8). Validation
 * (base58 checksum, not the token contract) and the permission check are
 * server-side; the disabled button for a view-only operator is a courtesy.
 */
export function DepositConfigurationView({
  configuration,
}: {
  configuration: AdminDepositConfiguration;
}) {
  const store = useAdminStore();
  const router = useRouter();
  const allowed = canManage(store.session, "deposits");
  const [address, setAddress] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const candidate = address.trim();
  const plausible = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(candidate);
  const unchanged = candidate === configuration.address;

  function save(reason: string) {
    startTransition(async () => {
      const result = await setDepositAddressAction({ address: candidate, reason });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(result.message);
      setAddress("");
      setConfirming(false);
      router.refresh();
    });
  }

  const sourceLabel =
    configuration.source === "configured"
      ? "Saved in the CRM"
      : configuration.source === "environment"
        ? "Deployment default (TRON_PLATFORM_DEPOSIT_ADDRESS)"
        : "Not set";

  return (
    <AdminSection className="space-y-4">
      <DetailCard
        title="Active deposit address"
        description="Shown to every customer who starts a deposit. Existing deposit requests keep the address they were given."
      >
        <DetailList>
          <DetailRow label="Network">{configuration.networkLabel}</DetailRow>
          <DetailRow label="Asset">
            {configuration.asset} ({configuration.standard})
          </DetailRow>
          <DetailRow label="Deposit address" wide>
            {configuration.address ? (
              <MonoValue className="break-all">{configuration.address}</MonoValue>
            ) : (
              <span className="text-sm text-warning">
                None — customers cannot start a deposit.
              </span>
            )}
          </DetailRow>
          <DetailRow label="Source">
            <Badge variant={configuration.source === "none" ? "warning" : "outline"}>
              {sourceLabel}
            </Badge>
          </DetailRow>
          <DetailRow label="Last updated">
            {configuration.updatedAt
              ? `${formatDateTimeUtc(configuration.updatedAt)} by ${configuration.updatedBy ?? "unknown"}`
              : "—"}
          </DetailRow>
        </DetailList>
      </DetailCard>

      <DetailCard
        title="Change the deposit address"
        description="Paste an address from a wallet you control. It is checked for a valid TRON checksum before it is saved, and the change is recorded in the audit log."
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (plausible && !unchanged && allowed) setConfirming(true);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="deposit-address">New TRON (TRC-20) address</Label>
            <Input
              id="deposit-address"
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-base"
              placeholder="T…"
              value={address}
              onChange={(event) => setAddress(event.target.value.trim())}
              disabled={!allowed}
            />
            {candidate && !plausible ? (
              <p className="text-xs text-destructive">
                A TRON address is 34 characters and starts with T.
              </p>
            ) : null}
          </div>
          <Button
            type="submit"
            variant="brand"
            disabled={!allowed || !plausible || unchanged || pending}
          >
            <KeyRound className="size-4" aria-hidden />
            Save
          </Button>
          {!allowed ? (
            <p className="text-xs text-muted-foreground">
              Changing the deposit address needs manage access to Deposits.
            </p>
          ) : null}
        </form>
      </DetailCard>

      <DetailCard title="Change history" description="From the audit log, newest first.">
        {configuration.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No changes recorded. The address above has not been changed in the CRM.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {configuration.history.map((entry) => (
              <li key={entry.id} className="space-y-0.5 py-2.5 first:pt-0 last:pb-0">
                <p className="text-xs text-muted-foreground">
                  {formatDateTimeUtc(entry.at)} · {entry.actor}
                </p>
                <p className="break-words text-sm">{entry.details}</p>
              </li>
            ))}
          </ul>
        )}
      </DetailCard>

      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Change the deposit address?"
        description={
          <>
            Every new deposit request will tell customers to send USDT to{" "}
            <span className="break-all font-mono">{candidate}</span>. Funds sent to an address
            you do not control cannot be recovered. Check it against your wallet before
            confirming.
          </>
        }
        confirmLabel={pending ? "Saving…" : "Change address"}
        destructive
        reason={{
          label: "Reason for the change",
          placeholder: "e.g. rotating to the new treasury wallet",
          required: true,
        }}
        onConfirm={save}
      />
    </AdminSection>
  );
}
