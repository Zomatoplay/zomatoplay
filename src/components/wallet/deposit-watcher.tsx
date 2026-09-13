"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RadioTower } from "lucide-react";

import { CurrencyDisplay } from "@/components/shared/currency-display";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import {
  checkForDepositsAction,
  type DepositActivityItem,
} from "@/app/(app)/wallet/deposit/actions";

/**
 * Watches for the caller's own deposits while the deposit screen is open.
 *
 * WHAT IT DOES, AND IN WHICH ORDER
 * --------------------------------
 * One server action per cycle, which does two things server-side in sequence:
 * asks the existing TRON scanner for a pass, then reads this account's deposit
 * state back. The browser gets a list it can render and nothing else — no
 * address, no chain call, no credential, and no say in whose deposits come
 * back. See `checkForDepositsAction`.
 *
 * WHY A TIMER, AND WHY FIVE SECONDS
 * ---------------------------------
 * This deployment's scheduled scan runs once a day on the Hobby plan (§18.5),
 * so somebody who has just sent USDT would otherwise sit on a screen that
 * could not update for hours. Five seconds is faster than TRON's ~3-second
 * block time matters for — the wait is solidification, not block inclusion —
 * and it is what the migration brief asked for so a real transfer can be
 * watched arriving.
 *
 * It is not free, and the cost is stated rather than hidden: each cycle is one
 * server action, which asks for a scanner pass and then reads this account's
 * deposits from a five-connection pool (§16.1a). Two things keep that bounded
 * — `busy` below, so a slow cycle is never overlapped by the next tick, and
 * the floor in `triggerDepositScan`, so the passes themselves are rate-limited
 * server-side however many screens are open.
 *
 * **Temporary, and page-scoped on purpose.** The interval is cleared on
 * unmount, so nothing keeps polling once the screen is gone — which also means
 * a transfer arriving after the tab closes is found by the cron pass and by
 * nothing else. This does not replace that scheduler.
 */

/** Matches the cadence the copy promises the person reading the screen. */
const POLL_INTERVAL_MS = 5_000;

export function DepositWatcher() {
  const router = useRouter();
  const [deposits, setDeposits] = useState<DepositActivityItem[] | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /*
   * Refs rather than state for both of these.
   *
   * `busy` guards against a slow pass overlapping the next tick — a scan walks
   * the pool and can take longer than the interval — and `signature` is only
   * ever compared, never rendered, so putting either in state would re-render
   * the card for nothing.
   */
  const busy = useRef(false);
  const signature = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const result = await checkForDepositsAction();
      if (!result.ok) {
        setError(result.message ?? "Could not check for deposits.");
        return;
      }
      setError(null);
      setDeposits(result.deposits);

      // A status change is money moving — the balance on `/wallet` and the
      // transaction list are now stale. Refreshed only on an actual change, so
      // an idle screen re-renders nothing every thirty seconds.
      const next = result.deposits.map((d) => `${d.id}:${d.status}`).join("|");
      if (signature.current !== null && signature.current !== next) {
        router.refresh();
      }
      signature.current = next;
    } catch {
      // A failed poll is a delay, not a failure of the page. The next tick
      // tries again, and the deposit is on-chain either way.
      setError("Could not reach the server. Trying again shortly.");
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    // The first check is unconditional: the screen has just been opened, and
    // it has nothing to show until one has run.
    void check();

    const timer = setInterval(() => {
      // A background tab is nobody watching. Skipping the tick keeps a screen
      // left open overnight from spending TronGrid quota all night; the next
      // visible tick picks it up.
      if (document.hidden || cancelled) return;
      void check();
    }, POLL_INTERVAL_MS);

    return () => {
      // The whole cycle stops with the screen: no timer survives the unmount,
      // and a tick that fires between the flag and the clear finds `cancelled`
      // and does nothing. A check already in flight resolves into state
      // setters React discards for an unmounted component.
      cancelled = true;
      clearInterval(timer);
    };
  }, [check]);

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-start gap-2.5">
        {checking ? (
          <Loader2 className="mt-px size-4 shrink-0 animate-spin text-brand" aria-hidden />
        ) : (
          <RadioTower className="mt-px size-4 shrink-0 text-brand" aria-hidden />
        )}
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {checking ? "Checking for new deposits…" : "Watching this address"}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground" aria-live="polite">
            This address belongs only to your account. A transfer to it is detected
            on-chain, finalised and credited automatically — this screen checks every
            5 seconds while it is open, so there is nothing to refresh.
          </p>
        </div>
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/8 p-3 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          <span>{error}</span>
        </p>
      ) : null}

      {deposits && deposits.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {deposits.map((deposit) => (
            <li key={deposit.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <CurrencyDisplay amount={deposit.amountUsdt} size="xs" hideInr />
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {deposit.txHashShort}
                </p>
              </div>
              <StatusBadge kind="deposit" status={deposit.status} />
            </li>
          ))}
        </ul>
      ) : null}

      {deposits && deposits.length === 0 ? (
        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          No deposits to this address yet.
        </p>
      ) : null}
    </Card>
  );
}
