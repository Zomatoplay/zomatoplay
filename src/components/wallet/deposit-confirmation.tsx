"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, TrendingUp, Wallet } from "lucide-react";

import { CurrencyDisplay } from "@/components/shared/currency-display";
import { InfoRow } from "@/components/shared/info-row";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatUsdt } from "@/lib/currency";
import { formatDateTimeUtc } from "@/utils/format";
import {
  acknowledgeDepositAction,
  type NewDepositView,
} from "@/app/(app)/wallet/deposit/actions";

/**
 * "USDT deposit confirmed" — shown once per newly credited deposit.
 *
 * WHAT DECIDES THAT IT IS NEW: THE DATABASE, NOT THIS COMPONENT
 * -------------------------------------------------------------
 * Every deposit handed to this component satisfies
 * `status = 'credited' and acknowledged_at is null` on its own row. So the
 * card corresponds to money that has actually reached the wallet — never to a
 * transfer that has merely been seen — and it stops appearing when the person
 * dismisses it, on every device, because the marker is a column and not
 * browser storage. See `listUnacknowledgedDeposits`.
 *
 * WHY IT PERSISTS UNTIL DISMISSED RATHER THAN VANISHING ON REFRESH
 * -----------------------------------------------------------------
 * Acknowledging on *render* would be the other obvious design and is worse in
 * both directions: a deposit credited while the tab was in the background
 * would be marked seen by nobody, and a person who refreshed mid-read would
 * lose the confirmation of a transfer they were still checking. An explicit
 * dismissal is also the only version that is honestly idempotent — the same
 * deposit cannot be re-announced, and dismissing twice does nothing.
 *
 * The two actions offered are the two things somebody does next with money
 * that has just arrived: look at the wallet, or allocate it.
 */
export function DepositConfirmation({
  deposits,
  availableUsdt,
  className,
}: {
  deposits: NewDepositView[];
  /** The balance the deposit landed in. Null when it could not be read. */
  availableUsdt: number | null;
  className?: string;
}) {
  if (deposits.length === 0) return null;

  return (
    <div className={className}>
      <ul className="space-y-3">
        {deposits.map((deposit) => (
          <li key={deposit.id}>
            <ConfirmationCard deposit={deposit} availableUsdt={availableUsdt} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ConfirmationCard({
  deposit,
  availableUsdt,
}: {
  deposit: NewDepositView;
  availableUsdt: number | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /*
   * Hidden locally the instant the server confirms, rather than waiting for
   * the refresh to bring back a list without it. The server write is what
   * makes it permanent; this only avoids a card sitting there looking
   * un-dismissed for a round trip.
   */
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  function dismiss(then?: () => void) {
    startTransition(async () => {
      await acknowledgeDepositAction({ depositId: deposit.id });
      setDismissed(true);
      router.refresh();
      then?.();
    });
  }

  return (
    <Card className="space-y-4 border-brand/40 bg-brand-soft/40 p-5">
      <div className="flex items-start gap-3">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground"
          aria-hidden
        >
          <CheckCircle2 className="size-5" />
        </span>
        <div className="min-w-0 space-y-1">
          {/*
            `aria-live` so a deposit arriving while the screen is open is
            announced, not only drawn. This card can appear without any
            interaction — the watcher polls — and a screen-reader user would
            otherwise never know the money landed.
          */}
          <h2 className="text-base font-semibold tracking-tight" aria-live="polite">
            USDT deposit confirmed
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">
              {formatUsdt(deposit.amountUsdt)}
            </strong>{" "}
            has been added to your wallet.
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-card p-4">
        <CurrencyDisplay amount={deposit.amountUsdt} size="lg" />
      </div>

      <div className="divide-y divide-border rounded-xl border border-border bg-card px-4">
        <InfoRow label="Network" value={deposit.networkLabel} />
        <InfoRow label="Token" value={deposit.tokenLabel} />
        <InfoRow
          label="Confirmations"
          value={`${deposit.confirmationsCurrent} of ${deposit.confirmationsRequired}`}
          // The chain's own irreversibility marker, named rather than implied:
          // a credited deposit is credited because its block solidified.
          hint="Final on the network"
        />
        {/*
          The hash, shortened. Enough to match against a wallet's own history
          without putting 64 characters on a 360px screen; the full value is on
          the transaction in wallet history.
        */}
        <InfoRow
          label="Transaction"
          value={<span className="font-mono text-xs">{deposit.txHashShort}</span>}
        />
        {deposit.creditedAt ? (
          /*
            `formatDateTimeUtc`, with the zone written down. This is a
            timestamp somebody will compare against their wallet app's own
            record, and an unlabelled clock in a zone that is not theirs is
            exactly what made the system log read as wrong (CLAUDE.md §11).
          */
          <InfoRow label="Credited" value={formatDateTimeUtc(deposit.creditedAt)} />
        ) : null}
        {availableUsdt !== null ? (
          <InfoRow label="Available balance" value={formatUsdt(availableUsdt)} />
        ) : null}
      </div>

      {/* Stacks on a phone, side by side from `sm` up. Both targets ≥ 44px. */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          variant="brand"
          size="lg"
          className="sm:flex-1"
          disabled={pending}
          onClick={() => dismiss(() => router.push("/wallet"))}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Wallet className="size-4" aria-hidden />
          )}
          View wallet
        </Button>
        <Button
          asChild
          variant="outline"
          size="lg"
          className="sm:flex-1"
          disabled={pending}
        >
          {/*
            A real link, so it works on a cold load and can be opened in a new
            tab. Dismissal rides the click rather than gating the navigation:
            somebody who taps "Invest now" has plainly seen the confirmation.
          */}
          <Link href="/plans" onClick={() => dismiss()}>
            <TrendingUp className="size-4" aria-hidden />
            Invest now
          </Link>
        </Button>
      </div>

      <Button
        variant="ghost"
        size="sm"
        block
        disabled={pending}
        onClick={() => dismiss()}
      >
        Dismiss
      </Button>
    </Card>
  );
}
