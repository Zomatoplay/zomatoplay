import { NextResponse, type NextRequest } from "next/server";

import { isCronRequestAuthorised } from "@/server/cron-auth";
import { isTronConfigured } from "@/server/tron/config";
import {
  scanDeposits,
  ScannerUnavailableError,
} from "@/server/tron/scanner";
import { sweepDepositAddresses } from "@/server/services/deposit-address-sweep.service";

/**
 * The scheduled deposit scan.
 *
 * WHAT THIS CLOSES
 * ----------------
 * The scanner itself was complete and correct — it detects, filters, waits for
 * solidification and records idempotently. What did not exist was anything to
 * *run* it in a deployment: `npm run tron:scan` is a terminal command, so
 * detection only ever happened when a person remembered to type it. On the
 * configured project the last successful pass was recorded on 2026-08-23 and
 * nothing had run since, which is what "the application did not detect my
 * transfer" actually means. The transfer was found the day it arrived, by a
 * hand-run pass; the two weeks of silence afterwards were the gap.
 *
 * WHY A ROUTE AND NOT A TIMER
 * ---------------------------
 * A `setInterval` in the server process is the obvious alternative and is wrong
 * on this platform twice over: serverless instances are created and frozen per
 * request, so a timer either never fires or fires once per instance — which
 * with several instances is several concurrent scanners. A scheduler calling a
 * URL is the shape the platform actually offers, and it gives exactly one
 * caller. `vercel.json` holds the schedule.
 *
 * NOTHING ABOUT PAGE RENDERING CHANGES
 * ------------------------------------
 * This is the *only* place in the application where a TronGrid request happens
 * outside a CLI script. No layout, no page and no server action reaches the
 * chain: `/wallet/deposit` reads `getPublicDepositTarget()`, which reads
 * environment variables and validates an address locally. A person opening the
 * wallet waits for no blockchain call, before this change or after it.
 *
 * IT STILL CREDITS NOBODY
 * -----------------------
 * A recorded deposit is unassigned (`deposits.user_id` is null) until an
 * operator attributes it in `/admin/deposits`. One shared receiving address
 * cannot say whose money arrived — CLAUDE.md §18.4 — and this route does not
 * pretend otherwise.
 */

/**
 * Node, and never prerendered.
 *
 * The scanner reaches `postgres` and `node:crypto`; the Edge runtime has
 * neither.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A pass walks up to twenty pages and makes one extra call per candidate
 * transfer, so it is bounded but not fast. Sixty seconds is the ceiling on
 * Vercel's default plan; a pass that cannot finish in it is reported as a
 * failure rather than silently truncated, and the next pass re-reads the same
 * window because the cursor is only advanced on success.
 */
export const maxDuration = 60;

async function runScan(request: NextRequest) {
  if (!(await isCronRequestAuthorised(request))) {
    // 401 rather than 404: a scheduler misconfigured with the wrong secret
    // should say so, and there is nothing secret about this path existing.
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (!isTronConfigured()) {
    // Not an error. A deployment with no chain integration is a supported
    // configuration, and a scheduler should not alarm about it every tick.
    return NextResponse.json(
      { skipped: true, reason: "TRON is not configured." },
      { status: 200 },
    );
  }

  try {
    const summary = await scanDeposits();

    /*
     * The address sweep runs on the scan's schedule too, and after it.
     *
     * After, because the scan is what turns a `confirming` deposit into a
     * `confirmed` or `credited` one — so sweeping first would refuse addresses
     * that this very pass has just made releasable, and the capacity would sit
     * unavailable until tomorrow.
     *
     * Here as well as on its own route because a scheduler is not guaranteed
     * to be running, and because on Vercel's Hobby plan every job is capped at
     * once a day (§18.5) — so the dedicated sweep route runs daily too. A
     * second trigger on this pass halves the worst-case wait for capacity, and
     * a deployment that can only schedule the deposit scan still gets its pool
     * swept. (The *number* of cron jobs is not a constraint: Hobby allows 100
     * per project, the same as Pro. Only frequency and precision are capped.)
     *
     * Never allowed to fail the scan: detection is the more important half,
     * and an address that stays assigned for another cycle costs capacity
     * rather than money.
     */
    let addressSweep: { examined: number; released: number; blocked: number } | null =
      null;
    try {
      const swept = await sweepDepositAddresses();
      addressSweep = {
        examined: swept.examined,
        released: swept.released,
        blocked: swept.blocked,
      };
    } catch {
      // Reported as null below rather than swallowed silently — the sweep's own
      // instrumentation has already recorded why.
    }

    return NextResponse.json({
      ok: true,
      scanned: summary.scanned,
      recorded: summary.created,
      updated: summary.updated,
      unchanged: summary.unchanged,
      awaitingConfirmation: summary.pending,
      rejected: summary.rejected,
      solidBlock: summary.solidBlock,
      addressSweep,
    });
  } catch (error) {
    /*
     * A failed pass is a 500, deliberately.
     *
     * The scheduler's own failure log is the cheapest monitoring this
     * deployment has, and a scanner that has been failing since Tuesday looks
     * exactly like a quiet week from the deposits table alone. `noteFailure()`
     * inside the scanner has already recorded it in `chain_scan_state`; this
     * makes it visible without opening the CRM.
     */
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof ScannerUnavailableError || error instanceof Error
            ? error.message
            : "The scan failed.",
      },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues a GET. */
export const GET = runScan;
/** POST is accepted so an operator can trigger a pass with curl. */
export const POST = runScan;
