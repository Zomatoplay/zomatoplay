import "server-only";

import { recordPipelineEvent } from "../observability";
import { scanDeposits, ScannerUnavailableError, type ScanSummary } from "./scanner";

/**
 * Running the deposit scanner from a request, safely.
 *
 * WHY THIS EXISTS
 * ---------------
 * The scanner has exactly one production trigger, `/api/cron/scan-deposits`,
 * and on the Hobby plan that fires once a day (§18.5). Watching a transfer
 * arrive therefore meant typing `npm run tron:scan` and reloading the page.
 * The deposit screen now asks for a pass itself while somebody is sitting on
 * it — see `checkDepositRequestAction`.
 *
 * **This is a user-active-page mechanism for testing, not the scheduler.** It
 * only runs while a deposit screen is open, which is precisely when nobody
 * needs it least: a transfer that arrives after the tab is closed is still
 * detected by the cron pass and by nothing else. Do not delete the cron route
 * on the strength of this, and do not grow this into the scheduler — §18.5
 * explains why a timer inside the server process is the wrong shape here.
 *
 * WHAT MAKES IT SAFE TO CALL FROM A REQUEST
 * -----------------------------------------
 * A scan is global: it walks the whole address pool, spends TronGrid quota and
 * holds database connections out of a five-connection pool (§16.1a). One
 * person's 5-second poll is fine; twenty people's is not, and neither is one
 * person's twenty rapid navigations — an abandoned request is not a cancelled
 * one (§16.1a note 7).
 *
 * So two limits, both in-process:
 *
 * - **Single flight.** Concurrent callers join the pass already running rather
 *   than starting another.
 * - **A floor between passes.** A call arriving less than
 *   `DEPOSIT_SCAN_MIN_INTERVAL_MS` after the last one finished is answered
 *   with the state as it stands, not with a new pass.
 *
 * In-process means per instance, so two instances can still scan at once. That
 * is not a correctness problem and never was: recording is idempotent at the
 * database level (unique `(chain, tx_hash)`), the cursor only ever moves
 * forward (`greatest`), and CLAUDE.md §18.5 says the cursor is an optimisation
 * rather than a correctness mechanism. What these limits buy is quota and
 * connections, which is the thing actually worth protecting.
 */

/**
 * The server-side backstop, sized against the client's *scan* cadence.
 *
 * `DepositFlow` polls the database every 5 s but asks for a chain scan only
 * every 60 s (see its `SCAN_INTERVAL_MS`), because nothing can be credited
 * before its block solidifies — ~57 s on TRON. This floor therefore has room
 * to be meaningful: at 15 s one instance cannot exceed four passes a minute no
 * matter how many screens are open, while a given screen's 60-second request
 * is comfortably clear of it and is never told "too soon".
 *
 * History, because both previous values were wrong in instructive ways. It was
 * 20 s against a 30 s client cadence, then dropped to 4 s when the client moved
 * to 5 s — which kept the floor below the cadence but made the cadence itself
 * the problem, since every tick then asked for a real chain scan. Splitting the
 * cheap read from the expensive scan is what let this go back up. **Keep this
 * below the client's scan interval and above its poll interval.**
 */
export const DEPOSIT_SCAN_MIN_INTERVAL_MS = 15_000;

export type ScanTriggerOutcome =
  /** This call ran a pass. */
  | "scanned"
  /** A pass was already running; this call waited for it. */
  | "joined"
  /** A pass finished too recently to justify another. */
  | "throttled"
  /** The pass ran and failed. The caller still gets the stored state. */
  | "failed";

export interface ScanTriggerResult {
  outcome: ScanTriggerOutcome;
  /** Null for `throttled`, and for `failed`. */
  summary: ScanSummary | null;
  /** Set only when `outcome` is `failed`. */
  error?: string;
}

/**
 * Wraps a scan function in the two limits above.
 *
 * Exported as a factory so the limits can be tested without a chain, a
 * database or a clock: the module-level trigger below is one instance of it.
 * It never throws — a scan failure is an outcome, because the caller's real
 * job is reading the deposit state and a broken TronGrid must not stop it.
 */
export function createScanTrigger(
  runScan: () => Promise<ScanSummary>,
  options: { minIntervalMs?: number; now?: () => number } = {},
) {
  const minIntervalMs = options.minIntervalMs ?? DEPOSIT_SCAN_MIN_INTERVAL_MS;
  const now = options.now ?? Date.now;

  let inFlight: Promise<ScanSummary> | null = null;
  let lastFinishedAt = Number.NEGATIVE_INFINITY;

  return async function trigger(): Promise<ScanTriggerResult> {
    const running = inFlight;
    if (running) {
      try {
        return { outcome: "joined", summary: await running };
      } catch (error) {
        return { outcome: "failed", summary: null, error: describe(error) };
      }
    }

    if (now() - lastFinishedAt < minIntervalMs) {
      return { outcome: "throttled", summary: null };
    }

    const pass = runScan();
    inFlight = pass;
    try {
      const summary = await pass;
      return { outcome: "scanned", summary };
    } catch (error) {
      return { outcome: "failed", summary: null, error: describe(error) };
    } finally {
      // A failed pass counts against the interval too. A TronGrid outage that
      // rejects instantly would otherwise be retried on every poll of every
      // open deposit screen.
      lastFinishedAt = now();
      inFlight = null;
    }
  };
}

function describe(error: unknown): string {
  if (error instanceof ScannerUnavailableError) return error.message;
  return error instanceof Error ? error.message : "The scan failed.";
}

const trigger = createScanTrigger(() => scanDeposits());

/**
 * Asks for a scanner pass on behalf of an open deposit screen.
 *
 * Never throws, and never reports a scan it did not run: `throttled` and
 * `joined` are outcomes the caller can show honestly rather than a silent
 * "ok".
 */
export async function triggerDepositScan(): Promise<ScanTriggerResult> {
  const result = await trigger();

  recordPipelineEvent({
    pipeline: "chain_scanner",
    operation: "chain.scan.requested",
    status: result.outcome === "failed" ? "failed" : "ok",
    message: `Deposit screen requested a scan (${result.outcome})`,
    errorMessage: result.error ?? null,
    metadata: {
      outcome: result.outcome,
      created: result.summary?.created ?? 0,
      updated: result.summary?.updated ?? 0,
    },
  });

  return result;
}
