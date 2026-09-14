"use client";

import { Suspense, use, useState } from "react";
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
 *
 * WHY IT ARRIVES AS A *PROMISE*
 * -----------------------------
 * The page used to `await` it before returning any HTML, so tapping "Add
 * funds" showed the route's loading skeleton until the pool lookup came back —
 * a round trip on a good day, four on a first-ever allocation, and a
 * `PoolExhaustedError` retry on a bad one.
 *
 * Nothing on the first stage needs the address. "Select network", the
 * TRC-20-only warning and the Continue button are constants, and the warning
 * is the thing a person most needs to read before an address is on screen at
 * all. So the page hands this component the unawaited promise, the shell
 * renders immediately, and only the panel that actually shows an address
 * suspends — usually finishing while the person is still reading the warning.
 *
 * Nothing about where the address comes from changes. It is still resolved
 * server-side from the session; `use()` only decides *when* this component
 * reads the answer.
 */

/** The one asset Nanotron accepts, on the one chain it scans. */
const TOKEN_LABEL = "USDT (TRC-20)";

export function DepositNetworkSelect({
  deposit,
  /**
   * Which TRON network this deployment is on, resolved server-side from the
   * environment rather than from the address lookup.
   *
   * Passed separately and eagerly for one reason: the first stage tells the
   * person whether the funds they are about to send are real, and that
   * sentence must not wait on a database read — nor default to the wrong one
   * while it does. Telling somebody their real USDT is test funds is the worst
   * thing this screen could print.
   */
  isTestnet,
  networkLabel,
}: {
  /** Resolved server-side for this account, streamed in — see the page. */
  deposit: Promise<DepositAddressResult>;
  isTestnet: boolean;
  networkLabel: string;
}) {
  const [stage, setStage] = useState<"select" | "show">("select");

  const chainLabel = `TRON ${networkLabel}`;

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

      {/*
        Only the address itself waits.

        The heading, the Change control and the three warnings below are all
        constants, so they paint immediately and the layout is its final size
        before the address lands — no jump when it does.
      */}
      <Suspense fallback={<AddressPanelSkeleton />}>
        <DepositAddressPanel deposit={deposit} chainLabel={chainLabel} />
      </Suspense>

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
          The mainnet counterpart, and the reason the testnet notice is a
          branch rather than a constant: this screen used to say "this is a
          test network" unconditionally, resting on the integration refusing
          mainnet. Telling somebody their real USDT is test funds is the worst
          sentence this page could print.
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
        them.
      */}
      <p className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed">
        <AlertTriangle className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden />
        <span className="text-muted-foreground">
          <strong className="font-medium text-foreground">Send USDT (TRC-20) only.</strong>{" "}
          Do <strong className="font-medium text-foreground">not</strong> send TRX — it is
          TRON&rsquo;s own coin, not USDT, and it cannot be detected or credited.
        </span>
      </p>
    </div>
  );
}

/**
 * The address, its QR and the watcher — everything that needs the server's
 * answer, and nothing that does not.
 *
 * `use()` suspends until the promise the page started resolves. Note what is
 * *inside* this boundary: `DepositWatcher` is mounted here rather than beside
 * it, so the five-second poll begins only once there is a real address to
 * watch. A watcher mounted next to a skeleton would be polling for deposits to
 * an address the screen cannot yet name.
 */
function DepositAddressPanel({
  deposit,
  chainLabel,
}: {
  deposit: Promise<DepositAddressResult>;
  chainLabel: string;
}) {
  const resolved = use(deposit);

  if (!resolved.ok) {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-2.5">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-semibold">Could not get your deposit address</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {resolved.message ?? "Something went wrong. Try again shortly."}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card className="space-y-4 p-5">
        {/*
          Generated server-side from the address the server issued, and
          carrying that address and nothing else — no amount, no token
          parameter, no URI scheme. See `getMyDepositAddressAction`, which is
          also the reason the QR and the copyable text below it cannot
          disagree: they are the same string.
        */}
        {resolved.qrSvg ? (
          <QrCode
            svg={resolved.qrSvg}
            label={`QR code for your ${TOKEN_LABEL} deposit address on ${chainLabel}`}
          />
        ) : null}
        <CopyField
          label="Deposit address"
          value={resolved.address ?? ""}
          successMessage="Deposit address copied"
        />
      </Card>

      {/*
        Mounted here and nowhere else: the polling cycle exists only while a
        real, supported deposit address is on screen, and unmounts with it.
        See `DepositWatcher`.
      */}
      <DepositWatcher />
    </>
  );
}

/**
 * The address panel's placeholder, shaped like what replaces it.
 *
 * Sized to the real QR and the real copy field so the page does not move when
 * the address lands — a layout that jumps under somebody's thumb while they
 * are about to tap "copy" on a blockchain address is worse than a slower one.
 */
function AddressPanelSkeleton() {
  return (
    <Card className="space-y-4 p-5" aria-busy="true">
      <span className="sr-only">Loading your deposit address</span>
      <div className="mx-auto size-44 animate-pulse rounded-xl bg-secondary" />
      <div className="space-y-2">
        <div className="h-3 w-28 animate-pulse rounded-md bg-secondary" />
        {/*
          Blurred rather than blank: the field keeps the exact height and
          rhythm of a real address, so nothing reflows, while being visibly
          unreadable so nobody starts copying a placeholder.
        */}
        <div className="h-11 w-full animate-pulse rounded-xl bg-secondary" />
      </div>
    </Card>
  );
}
