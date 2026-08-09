"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
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
import { Progress } from "@/components/ui/progress";
import { depositNetworks } from "@/data/transactions";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { usePrototypeStore } from "@/lib/prototype-store";
import { cn } from "@/lib/utils";
import { truncateMiddle } from "@/utils/format";
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

const DEMO_DEPOSIT_DEFAULT = 250;

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
  qrCodes,
}: {
  /** Server-rendered QR SVGs, keyed by network id. */
  qrCodes: Record<DepositNetworkId, string>;
}) {
  const { creditDeposit } = usePrototypeStore();

  const [stage, setStage] = useState<DepositFlowStage>("select_network");
  const [networkId, setNetworkId] = useState<DepositNetworkId>("trc20");
  const [confirmations, setConfirmations] = useState(0);
  const [demoAmount, setDemoAmount] = useState(String(DEMO_DEPOSIT_DEFAULT));
  const [reference, setReference] = useState<string | null>(null);
  const [creditedAmount, setCreditedAmount] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const network = depositNetworks.find((item) => item.id === networkId)!;

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const amount = Number.parseFloat(demoAmount);
  const amountValid =
    Number.isFinite(amount) && amount >= network.minDeposit && amount > 0;

  /** Stands in for the chain watcher detecting and confirming a transfer. */
  const simulateIncomingTransfer = useCallback(() => {
    if (!amountValid) return;

    const txReference = `0x${Math.random().toString(16).slice(2).padEnd(12, "0")}${Math.random()
      .toString(16)
      .slice(2, 14)}`;
    setReference(txReference);
    setCreditedAmount(amount);
    setConfirmations(0);
    setStage("detected");

    // Brief "detected" beat, then confirmations tick up to the requirement.
    setTimeout(() => {
      setStage("confirming");
      timerRef.current = setInterval(() => {
        setConfirmations((current) => {
          const next = current + 1;
          if (next >= network.requiredConfirmations) {
            if (timerRef.current) clearInterval(timerRef.current);
            setStage("credited");
            creditDeposit({
              amount,
              network: network.id,
              reference: txReference,
            });
            toast.success("Deposit credited", {
              description: `${formatUsdt(amount)} added to your balance.`,
            });
            return network.requiredConfirmations;
          }
          return next;
        });
      }, 220);
    }, 1200);
  }, [amount, amountValid, creditDeposit, network.id, network.requiredConfirmations]);

  function restart() {
    if (timerRef.current) clearInterval(timerRef.current);
    setStage("select_network");
    setConfirmations(0);
    setReference(null);
    setCreditedAmount(0);
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
          {depositNetworks.map((item) => (
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
  /* Stage: credited                                                   */
  /* ---------------------------------------------------------------- */
  if (stage === "credited") {
    return (
      <div className="space-y-5">
        <Card className="p-6 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
            <CheckCircle2 className="size-7" aria-hidden />
          </span>
          <h2 className="mt-4 text-lg font-semibold">Deposit credited</h2>
          <p className="tabular mt-2 text-3xl font-semibold tracking-tight">
            {formatUsdt(creditedAmount)}
          </p>
          <p className="tabular text-sm text-muted-foreground">
            {formatUsdtAsInr(creditedAmount)}
          </p>
        </Card>

        <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
          <InfoRow label="Network" value={network.name} />
          <InfoRow
            label="Confirmations"
            value={`${network.requiredConfirmations}/${network.requiredConfirmations}`}
          />
          {reference ? (
            <InfoRow
              label="Transaction ID"
              value={
                <span className="font-mono text-xs">
                  {truncateMiddle(reference, 10, 8)}
                </span>
              }
            />
          ) : null}
        </div>

        <div className="space-y-2">
          <Button asChild variant="brand" size="lg" block>
            <Link href="/wallet">Back to wallet</Link>
          </Button>
          <Button variant="ghost" size="lg" block onClick={restart}>
            Make another deposit
          </Button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Stages: address / awaiting / detected / confirming                */
  /* ---------------------------------------------------------------- */
  const watching = stage === "detected" || stage === "confirming";
  const progress = (confirmations / network.requiredConfirmations) * 100;

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
          <p className="text-sm font-medium">
            {stage === "detected"
              ? "Transaction detected"
              : stage === "confirming"
                ? "Confirming on-chain"
                : "Waiting for your transfer"}
          </p>
        </div>

        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
          {stage === "detected"
            ? "We found your transaction in the mempool. Waiting for the first confirmation."
            : stage === "confirming"
              ? `${confirmations} of ${network.requiredConfirmations} confirmations. Your balance updates automatically.`
              : "This page updates automatically as soon as your deposit is detected on-chain. You can safely leave and come back."}
        </p>

        {stage === "confirming" ? (
          <Progress
            value={progress}
            className="mt-3"
            aria-label="Confirmation progress"
          />
        ) : null}

        {reference ? (
          <p className="mt-3 break-all font-mono text-[11px] text-muted-foreground">
            {truncateMiddle(reference, 14, 10)}
          </p>
        ) : null}
      </Card>

      {/* Demo-only control. Replaced by the real chain watcher at integration. */}
      {!watching ? (
        <Card className="space-y-3 border-dashed p-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Demo control
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              No blockchain is connected in this build. Use this to simulate an
              incoming transfer and watch the confirmation states.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="demo-amount" className="text-xs">
              Simulated amount (USDT)
            </Label>
            <Input
              id="demo-amount"
              inputMode="decimal"
              type="text"
              value={demoAmount}
              onChange={(event) =>
                setDemoAmount(event.target.value.replace(/[^0-9.]/g, ""))
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
            disabled={!amountValid}
            onClick={simulateIncomingTransfer}
          >
            Simulate incoming transfer
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
