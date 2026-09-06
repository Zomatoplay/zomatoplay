"use client";

import { useState } from "react";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";

import { CopyField } from "@/components/shared/copy-field";
import { InfoRow } from "@/components/shared/info-row";
import { QrCode } from "@/components/shared/qr-code";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { DepositAddressResult } from "@/app/(app)/wallet/deposit/actions";

/**
 * The real deposit flow: pick a network, get the address the server actually
 * issued for this account.
 *
 * WHAT THIS REPLACED
 * -------------------
 * A four-network catalogue (`trc20` / `bep20` / `polygon` / `erc20`) of
 * placeholder addresses nobody could send to, sat above a separate panel
 * showing the one real Shasta address the whole platform shared. Two networks
 * are supported at all — TRON mainnet (not yet enabled) and TRON's Shasta
 * testnet — and only one of those two can actually receive anything today, so
 * that is exactly what this shows: two options, one of them working.
 *
 * WHY THE ADDRESS ARRIVES AS A PROP, NOT A CLIENT FETCH
 * --------------------------------------------------------
 * `DepositAddressResult` is resolved server-side, in the page component, by
 * `getMyDepositAddressAction` — which resolves the account from the session
 * and calls `getOrCreateDepositAddress`. Nothing in this component, or
 * anywhere in the browser, ever supplies a user id, a network or an asset that
 * decides whose address comes back. This component only decides what to show.
 */

type NetworkId = "trc20_mainnet" | "shasta";

const NETWORK_COPY: Record<
  NetworkId,
  { label: string; chainLabel: string; available: boolean }
> = {
  trc20_mainnet: {
    label: "TRC20 USDT",
    chainLabel: "TRON mainnet",
    available: false,
  },
  shasta: {
    label: "Shasta Net USDT",
    chainLabel: "TRON Shasta testnet",
    available: true,
  },
};

export function DepositNetworkSelect({
  shasta,
}: {
  /** Already resolved server-side for this account — see the page. */
  shasta: DepositAddressResult;
}) {
  const [stage, setStage] = useState<"select" | "show">("select");
  const [networkId, setNetworkId] = useState<NetworkId>("shasta");

  if (stage === "select") {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Select network</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Deposits are accepted in USDT only. TRC20 USDT and Shasta Net USDT are
            different networks — sending to the wrong one loses the funds.
          </p>
        </div>

        <div className="space-y-3">
          {(Object.entries(NETWORK_COPY) as [NetworkId, (typeof NETWORK_COPY)[NetworkId]][]).map(
            ([id, copy]) => (
              <button
                key={id}
                type="button"
                disabled={!copy.available}
                onClick={() => setNetworkId(id)}
                aria-pressed={networkId === id}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  !copy.available && "cursor-not-allowed opacity-60",
                  networkId === id && copy.available
                    ? "border-brand bg-brand-soft"
                    : "border-border bg-card enabled:hover:bg-secondary/50",
                )}
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {copy.label}
                    </span>
                    {!copy.available ? <Badge variant="outline">Coming soon</Badge> : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {copy.chainLabel}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2",
                    networkId === id && copy.available ? "border-brand bg-brand" : "border-border",
                  )}
                >
                  {networkId === id && copy.available ? (
                    <span className="size-1.5 rounded-full bg-brand-foreground" />
                  ) : null}
                </span>
              </button>
            ),
          )}
        </div>

        <Button
          variant="brand"
          size="lg"
          block
          disabled={!NETWORK_COPY[networkId].available}
          onClick={() => setStage("show")}
        >
          Continue
          <ChevronRight className="size-4" />
        </Button>
      </div>
    );
  }

  const copy = NETWORK_COPY[networkId];

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{copy.label}</h2>
          <p className="text-xs text-muted-foreground">{copy.chainLabel}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setStage("select")}>
          Change
        </Button>
      </div>

      {!shasta.ok ? (
        <Card className="p-5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold">Could not get your deposit address</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {shasta.message ?? "Something went wrong. Try again shortly."}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card className="space-y-4 p-5">
            {shasta.qrSvg ? (
              <QrCode
                svg={shasta.qrSvg}
                label={`QR code for your ${copy.label} deposit address`}
              />
            ) : null}
            <CopyField
              label="Deposit address"
              value={shasta.address ?? ""}
              successMessage="Deposit address copied"
            />
          </Card>

          <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
            <InfoRow label="Network" value={`TRON · ${shasta.networkLabel ?? copy.chainLabel}`} />
            <InfoRow label="Token" value="USDT (TRC-20)" />
            <InfoRow label="This address belongs to" value="Your account only" />
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              This is a <strong className="font-medium text-foreground">test network</strong>.
              Send test USDT only — real USDT sent here is permanently lost.
            </span>
          </p>

          {/*
            The mistake this exists to prevent, stated first and plainly.

            Every TRC-20 address is also a valid address for the chain's native
            coin, and a wallet will happily send TRX to it. Those transfers
            succeed on-chain and are invisible to a TRC-20 transfer query — a
            different endpoint entirely — so nothing here detects or credits
            them. See CLAUDE.md §18.9 (H1) for the visibility gap this implies.
          */}
          <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
            <span className="text-muted-foreground">
              <strong className="font-medium text-foreground">Send USDT (TRC-20) only.</strong>{" "}
              Do <strong className="font-medium text-foreground">not</strong> send TRX — it is
              TRON&rsquo;s own coin, not USDT, and it cannot be detected or credited.
            </span>
          </p>

          <Card className="p-5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="size-4 shrink-0 animate-spin text-brand" aria-hidden />
              <p className="text-sm font-medium">Watching this address</p>
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
              This address belongs only to your account. A transfer to it is detected
              on-chain, finalised, and credited to your balance automatically — no
              further action needed here, and this page does not decide it.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
