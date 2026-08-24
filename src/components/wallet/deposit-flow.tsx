"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  Loader2,
  Radio,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";

import { CopyField } from "@/components/shared/copy-field";
import { InfoRow } from "@/components/shared/info-row";
import { QrCode } from "@/components/shared/qr-code";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { requestTestDeposit } from "@/app/(app)/wallet/deposit/actions";
import type { DepositFlowStage, DepositNetwork, DepositNetworkId } from "@/types";

/**
 * USDT deposit flow.
 *
 * Mirrors the intended production sequence:
 *   select network → show address → await transfer → detected →
 *   confirmations accumulate → credited
 *
 * The chain watcher is simulated by a timer behind an explicitly-labelled demo
 * control. INTEGRATION POINT: replace `simulateIncomingTransfer` with a
 * subscription to the deposit service (websocket / polling), and delete the
 * demo panel — the stages and their UI stay exactly as they are.
 */

/** The default amount in the development-only pending-deposit control. */
const TEST_DEPOSIT_DEFAULT = 250;

function NetworkOption({
  network,
  selected,
  onSelect,
}: {
  network: DepositNetwork;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border p-4 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        selected
          ? "border-brand bg-brand-soft"
          : "border-border bg-card hover:bg-secondary/50",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2",
          selected ? "border-brand bg-brand" : "border-border",
        )}
      >
        {selected ? (
          <span className="size-1.5 rounded-full bg-brand-foreground" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            {network.name}
          </span>
          {network.recommended ? (
            <span className="rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
              Recommended
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {network.chain} · {network.networkFeeNote} · arrives in{" "}
          {network.estimatedArrival}
        </span>
        <span className="tabular mt-0.5 block text-xs text-muted-foreground">
          Min {formatUsdt(network.minDeposit)} · {network.requiredConfirmations}{" "}
          confirmations
        </span>
      </span>
    </button>
  );
}

export function DepositFlow({
  networks,
  qrCodes,
}: {
  /** The deposit network catalogue, read server-side. */
  networks: DepositNetwork[];
  /** Server-rendered QR SVGs, keyed by network id. */
  qrCodes: Record<DepositNetworkId, string>;
}) {
  const [stage, setStage] = useState<DepositFlowStage>("select_network");
  const [networkId, setNetworkId] = useState<DepositNetworkId>("trc20");
  const [testAmount, setTestAmount] = useState(String(TEST_DEPOSIT_DEFAULT));
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const network = networks.find((item) => item.id === networkId)!;
  const amount = Number.parseFloat(testAmount);
  const amountValid = Number.isFinite(amount) && amount >= network.minDeposit && amount > 0;

  /**
   * Asks the server to record a pending deposit.
   *
   * This replaced a control that walked a fake confirmation counter and then
   * credited the wallet in the browser. Two things were wrong with that, and
   * the second is why React complained:
   *
   *  - It made up money. The balance moved without a ledger entry, without a
   *    chain transfer, and without anything server-side ever agreeing.
   *  - It called `creditDeposit()` from inside a `setConfirmations` updater.
   *    Updater functions must be pure — React runs them during render — so
   *    dispatching to the store from one updated `PrototypeStoreProvider`
   *    while `DepositFlow` was rendering. That is exactly the "Cannot update a
   *    component while rendering a different component" warning, and the fix
   *    is not to defer the call but to not make it.
   *
   * The wallet now only ever moves because the scanner verified a solidified
   * transfer.
   */
  function requestTestTransfer() {
    if (!amountValid || pending) return;
    startTransition(async () => {
      const result = await requestTestDeposit({ amount: testAmount });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setStage("awaiting_transfer");
      toast.success("Pending deposit recorded", { description: result.message });
      router.refresh();
    });
  }

  function restart() {
    setStage("select_network");
  }

  /* ---------------------------------------------------------------- */
  /* Stage: network selection                                          */
  /* ---------------------------------------------------------------- */
  if (stage === "select_network") {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">
            Select a network
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Deposits are accepted in USDT only. Choose the network you will send
            from — it must match, or your funds cannot be credited.
          </p>
        </div>

        <div className="space-y-3">
          {networks.map((item) => (
            <NetworkOption
              key={item.id}
              network={item}
              selected={item.id === networkId}
              onSelect={() => setNetworkId(item.id)}
            />
          ))}
        </div>

        <Button
          variant="brand"
          size="lg"
          block
          onClick={() => setStage("show_address")}
        >
          Continue
          <ChevronRight className="size-4" />
        </Button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Stages: address / awaiting                                        */
  /* ---------------------------------------------------------------- */
  // `detected` / `confirming` / `credited` are no longer client stages. They
  // are database statuses driven by the scanner, and the wallet reads them
  // from there — the browser has no way to know a transfer arrived.
  const watching = stage === "awaiting_transfer";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">
            {network.name}
          </h2>
          <p className="text-xs text-muted-foreground">{network.chain}</p>
        </div>
        <Button variant="outline" size="sm" onClick={restart}>
          Change
        </Button>
      </div>

      <Card className="space-y-4 p-5">
        <QrCode
          svg={qrCodes[networkId]}
          label={`QR code for your ${network.name} deposit address`}
        />
        <CopyField
          label="Deposit address"
          value={network.address}
          successMessage="Deposit address copied"
        />
      </Card>

      <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
        <InfoRow
          label="Minimum deposit"
          value={formatUsdt(network.minDeposit)}
          hint={formatUsdtAsInr(network.minDeposit)}
        />
        <InfoRow label="Confirmations required" value={String(network.requiredConfirmations)} />
        <InfoRow label="Typical arrival" value={network.estimatedArrival} />
      </div>

      {/* Warning is unmissable — sending the wrong asset is unrecoverable. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 p-3.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p className="text-xs leading-relaxed text-foreground">
          Send <strong>USDT on {network.chain}</strong> only. Sending any other
          token, or using a different network, will result in permanent loss of
          funds.
        </p>
      </div>

      {/* Live confirmation status */}
      <Card className="p-5">
        <div className="flex items-center gap-2.5">
          {watching ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-brand" aria-hidden />
          ) : (
            <Radio className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          <p className="text-sm font-medium">Waiting for your transfer</p>
        </div>

        <p
          className="mt-1.5 text-xs leading-relaxed text-muted-foreground"
          aria-live="polite"
        >
          Deposits are detected on-chain and credited after the transaction is
          final. Your balance updates once that happens — this page does not
          decide it, and cannot.
        </p>
      </Card>

      {/*
        Development only, and absent from a production build.

        It records a *pending* deposit through the same service layer an
        operator reviews. It does not credit anything, does not fabricate a
        transaction hash the explorer would resolve, and does not claim the
        chain saw anything. Only the scanner can turn a transfer into money.
      */}
      {process.env.NODE_ENV !== "production" && !watching ? (
        <Card className="space-y-3 border-dashed p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Development control
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Records a <strong className="font-medium text-foreground">pending</strong>{" "}
              deposit for the operator queue. It does not credit your balance —
              only a verified on-chain transfer does that.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="test-amount" className="text-xs">
              Amount (USDT)
            </Label>
            <Input
              id="test-amount"
              inputMode="decimal"
              type="text"
              value={testAmount}
              onChange={(event) =>
                setTestAmount(event.target.value.replace(/[^0-9.]/g, ""))
              }
              aria-invalid={!amountValid}
            />
            {!amountValid ? (
              <p className="text-xs text-destructive">
                Enter at least {formatUsdt(network.minDeposit)}.
              </p>
            ) : null}
          </div>
          <Button
            variant="outline"
            size="sm"
            block
            disabled={!amountValid || pending}
            onClick={requestTestTransfer}
          >
            {pending ? "Recording…" : "Record pending deposit"}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
