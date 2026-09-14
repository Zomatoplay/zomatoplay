"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, RadioTower } from "lucide-react";

import { CurrencyDisplay } from "@/components/shared/currency-display";
import { DepositConfirmation } from "@/components/wallet/deposit-confirmation";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card } from "@/components/ui/card";
import {
  checkForDepositsAction,
  type DepositActivityItem,
  type NewDepositView,
} from "@/app/(app)/wallet/deposit/actions";

/**
 * Watches for the caller's own deposits while the deposit screen is open.
 *
 * TWO CADENCES, NOT ONE
 * ---------------------
 * Every cycle calls one server action, and that action does two separable
 * things: read this account's deposits (cheap — a single indexed query), and
 * optionally ask the TRON scanner for a pass (expensive — measured p50
 * 3,891 ms of chain calls and cursor writes).
 *
 * - **Cheap, every 5 s.** Keeps the screen live: the moment the scanner or the
 *   cron credits something, this is what puts it on screen.
 * - **Expensive, every 60 s.** A transfer cannot be credited until its block
 *   solidifies, which on TRON is ~19 blocks — about 57 s. Polling the chain
 *   faster than that cannot produce an earlier answer; it only spends TronGrid
 *   quota and holds connections out of a five-connection pool (§16.1a).
 *
 * The two were one call at 5 s, which drove a chain scan roughly every 9 s for
 * as long as the page was open. That is the regression this split undoes.
 *
 * The browser gets a list it can render and nothing else — no address, no chain
 * call, no credential, and no say in whose deposits come back. Asking for a
 * scan grants nothing either: `triggerDepositScan` applies its own server-side
 * floor and single-flight regardless of who asked. See `checkForDepositsAction`.
 *
 * **Temporary, and page-scoped on purpose.** The interval is cleared on
 * unmount, so nothing keeps polling once the screen is gone — which also means
 * a transfer arriving after the tab closes is found by the cron pass and by
 * nothing else. This does not replace that scheduler.
 */

/**
 * The cheap tick: read this account's deposits. One indexed query.
 *
 * Matches the cadence the copy promises the person reading the screen.
 */
const POLL_INTERVAL_MS = 5_000;

/**
 * The expensive tick: ask the scanner to walk the chain.
 *
 * Measured 2026-09-13: a real pass costs p50 3,891 ms (a solidified-block
 * call, a TRC-20 query per watched address, a transaction-info call per
 * candidate, and a cursor read and write each). At the 5-second cadence that
 * ran essentially back to back for as long as the page was open.
 *
 * Sixty seconds, because that is what the chain actually allows: TRON
 * solidifies ~19 blocks behind — about 57 s — and nothing is credited before
 * its block solidifies. A faster chain poll cannot produce an earlier answer,
 * it can only spend more TronGrid quota and hold more of a five-connection
 * pool. The cheap tick above is what keeps the screen feeling live.
 */
const SCAN_INTERVAL_MS = 60_000;

export function DepositWatcher() {
  const router = useRouter();
  const [deposits, setDeposits] = useState<DepositActivityItem[] | null>(null);
  /*
   * The confirmation's own state, from the same poll.
   *
   * Server-decided: these are rows that are `credited` and not yet
   * acknowledged. The component below renders them and nothing here judges
   * whether a deposit is "new" — see `DepositConfirmation`.
   */
  const [newDeposits, setNewDeposits] = useState<NewDepositView[]>([]);
  const [availableUsdt, setAvailableUsdt] = useState<number | null>(null);
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
  /**
   * When this screen last asked for a chain scan.
   *
   * `0` rather than `Date.now()`, so the first tick after the screen opens does
   * request one — somebody who has just sent a transfer and opened this page is
   * exactly who should get a pass immediately.
   */
  const lastScanAt = useRef(0);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);

    // Decided here, not on the server: the server applies its own floor and
    // single-flight to whatever it is asked (see `triggerDepositScan`), so this
    // is a cadence choice, never a privilege.
    const now = Date.now();
    const requestScan = now - lastScanAt.current >= SCAN_INTERVAL_MS;
    if (requestScan) lastScanAt.current = now;

    try {
      const result = await checkForDepositsAction({ requestScan });
      if (!result.ok) {
        setError(result.message ?? "Could not check for deposits.");
        return;
      }
      setError(null);
      setDeposits(result.deposits);
      setNewDeposits(result.newDeposits);
      setAvailableUsdt(result.availableUsdt);

      // A status change is money moving — the balance on `/wallet` and the
      // transaction list are now stale. Refreshed only on an actual change, so
      // an idle screen re-renders nothing however often it polls.
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
    <>
      {/*
        Above the watcher, because a confirmed arrival is the answer to the
        question the watcher is asking. It renders nothing when there is
        nothing unacknowledged, which is the ordinary case.
      */}
      <DepositConfirmation
        deposits={newDeposits}
        availableUsdt={availableUsdt}
        className="mb-5"
      />

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
            on-chain, finalised and credited automatically — this screen checks for
            updates every few seconds while it is open, so there is nothing to
            refresh. A transfer needs about a minute on the network to become
            final before it can be credited.
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
    </>
  );
}
