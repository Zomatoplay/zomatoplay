"use client";

import { useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";

import { CopyField } from "@/components/shared/copy-field";
import { InfoRow } from "@/components/shared/info-row";
import { QrCode } from "@/components/shared/qr-code";
import { DepositWatcher } from "@/components/wallet/deposit-watcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { DepositAddressResult } from "@/app/(app)/wallet/deposit/actions";

/**
 * The real deposit flow: pick a network, get the address the server actually
 * issued for this account.
 *
 * WHAT THIS REPLACED
 * -------------------
 * A four-network catalogue (`trc20` / `bep20` / `polygon` / `erc20`) of
 * placeholder addresses nobody could send to, and then a two-entry list whose
 * second entry — TRC-20 on TRON mainnet — was permanently disabled behind a
 * "Coming soon" badge while the integration refused mainnet.
 *
 * ONE NETWORK, BECAUSE THERE IS ONE
 * ---------------------------------
 * Nanotron accepts USDT on TRON, as TRC-20, and nothing else. Which TRON
 * network that is — mainnet now, a testnet in a development environment — is
 * a server-side fact this component is *told*, never one it chooses: it
 * arrives on `DepositAddressResult` alongside the address the server issued.
 * Listing options that cannot receive anything was the old shape, and a
 * disabled row is still a row a person reads as a promise.
 *
 * The two-stage select → show flow is kept even with one option. It is the
 * only place the "USDT (TRC-20) only, never TRX" warning is guaranteed to be
 * read before an address is on screen.
 *
 * WHY THE ADDRESS ARRIVES AS A PROP, NOT A CLIENT FETCH
 * --------------------------------------------------------
 * `DepositAddressResult` is resolved server-side, in the page component, by
 * `getMyDepositAddressAction` — which resolves the account from the session
 * and calls `getOrCreateDepositAddress`. Nothing in this component, or
 * anywhere in the browser, ever supplies a user id, a network or an asset that
 * decides whose address comes back. This component only decides what to show.
 */

/** The one asset Nanotron accepts, on the one chain it scans. */
const TOKEN_LABEL = "USDT (TRC-20)";

export function DepositNetworkSelect({
  deposit,
}: {
  /** Already resolved server-side for this account — see the page. */
  deposit: DepositAddressResult;
}) {
  const [stage, setStage] = useState<"select" | "show">("select");

  // `networkLabel` is absent only when the server could not resolve an address
  // at all, and the error card below is what that case renders.
  const chainLabel = `TRON ${deposit.networkLabel ?? "network"}`;
  const isTestnet = deposit.isTestnet ?? true;

  if (stage === "select") {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Select network</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Deposits are accepted in USDT on the TRON network only. USDT sent over
            any other network — BEP20, ERC20, Polygon — cannot be detected or
            credited, and is lost.
          </p>
        </div>

        {/*
          Not a button, deliberately.

          With one network there is nothing to choose, and a control that
          re-selects the only already-selected option is a control that does
          nothing — worse than no control, because it invites a tap that has no
          effect. It is rendered as the selected row it is; `Continue` is the
          action. When a second network is genuinely supported this becomes a
          list of real buttons again.
        */}
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-brand bg-brand-soft p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-foreground">{TOKEN_LABEL}</span>
              {isTestnet ? <Badge variant="outline">Test network</Badge> : null}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{chainLabel}</p>
          </div>
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-brand bg-brand"
            aria-hidden
          >
            <span className="size-1.5 rounded-full bg-brand-foreground" />
          </span>
        </div>

        <Button variant="brand" size="lg" block onClick={() => setStage("show")}>
          Continue
          <ChevronRight className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">{TOKEN_LABEL}</h2>
          <p className="text-xs text-muted-foreground">{chainLabel}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setStage("select")}>
          Change
        </Button>
      </div>

      {!deposit.ok ? (
        <Card className="p-5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-semibold">Could not get your deposit address</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {deposit.message ?? "Something went wrong. Try again shortly."}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <>
          <Card className="space-y-4 p-5">
            {/*
              Generated server-side from the address the server issued, and
              carrying that address and nothing else — no amount, no token
              parameter, no URI scheme. See `getMyDepositAddressAction`, which
              is also the reason the QR and the copyable text below it cannot
              disagree: they are the same string.
            */}
            {deposit.qrSvg ? (
              <QrCode
                svg={deposit.qrSvg}
                label={`QR code for your ${TOKEN_LABEL} deposit address on ${chainLabel}`}
              />
            ) : null}
            <CopyField
              label="Deposit address"
              value={deposit.address ?? ""}
              successMessage="Deposit address copied"
            />
          </Card>

          <div className="divide-y divide-border rounded-2xl border border-border bg-card px-4">
            <InfoRow label="Network" value={chainLabel} />
            <InfoRow label="Token" value={TOKEN_LABEL} />
            <InfoRow label="This address belongs to" value="Your account only" />
          </div>

          {isTestnet ? (
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              <span>
                This is a <strong className="font-medium text-foreground">test network</strong>.
                Send test USDT only — real USDT sent here is permanently lost.
              </span>
            </p>
          ) : (
            /*
              The mainnet counterpart, and the reason the testnet notice is now
              a branch rather than a constant: this screen used to say "this is
              a test network" unconditionally, resting on the integration
              refusing mainnet. Telling somebody their real USDT is test funds
              is the worst sentence this page could print.
            */
            <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              <span>
                This is the{" "}
                <strong className="font-medium text-foreground">TRON main network</strong>. Funds
                sent here are real, and a transfer on a blockchain cannot be reversed — check the
                address before you send.
              </span>
            </p>
          )}

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

          {/*
            Mounted here and nowhere else: the polling cycle exists only while
            a real, supported deposit address is on screen, and unmounts with
            it. See `DepositWatcher`.
          */}
          <DepositWatcher />
        </>
      )}
    </div>
  );
}
