import { NextResponse, type NextRequest } from "next/server";

import { isDatabaseConfigured } from "@/db";
import { isCronRequestAuthorised } from "@/server/cron-auth";
import {
  BUSINESS_MIDNIGHT_UTC_HOUR,
  BUSINESS_MIDNIGHT_UTC_MINUTE,
  BUSINESS_TIMEZONE,
} from "@/lib/business-time";
import { releaseDueCommissions } from "@/server/services/referrals-write.service";

/**
 * The nightly referral-commission release.
 *
 * WHEN IT RUNS
 * ------------
 * `vercel.json` schedules it at `30 18 * * *` — **UTC**, which Vercel Cron
 * expects — and that is 00:00 in the business timezone (`Asia/Kolkata`,
 * UTC+05:30, no daylight saving). The two numbers are exported from
 * `business-time.ts` and referenced in the response below, so a schedule that
 * drifts from the calendar it is supposed to track is visible in the route's
 * own output rather than only in a cron expression nobody re-reads.
 *
 * WHY MISSING MIDNIGHT COSTS NOTHING
 * ----------------------------------
 * Eligibility is `release_at <= now`, not "became due since the last run". A
 * pass that does not happen at 00:00 — because the scheduler was down, the
 * deploy was mid-flight, or the platform throttled it — is *late*, not lossy:
 * the next successful pass finds everything still owed. See
 * `releaseDueCommissions`.
 *
 * WHY A URL AND NOT A TIMER
 * -------------------------
 * The same reason as the other two schedulers (CLAUDE.md §18.5): serverless
 * instances are frozen between requests, so a `setInterval` in the server
 * process either never fires or fires once per instance — and once per
 * instance, with several instances, is several concurrent release passes. A
 * scheduler calling a URL gives exactly one caller. Running it twice anyway is
 * safe, because every payment is guarded by its own status transition, but
 * "safe" is not a reason to arrange it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A pass is bounded to 500 entries and each release is its own transaction, so
 * the worst case is a few hundred round trips. Sixty seconds is Vercel's
 * default ceiling; a backlog larger than one pass can clear is picked up by
 * the next one, oldest first.
 */
export const maxDuration = 60;

async function run(request: NextRequest) {
  if (!(await isCronRequestAuthorised(request))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  if (!isDatabaseConfigured()) {
    // Not an error, and not a silent success either: there is nothing to
    // release because there is nowhere to read from, and a scheduler should be
    // told which of the two it is.
    return NextResponse.json(
      { skipped: true, reason: "No database is configured." },
      { status: 200 },
    );
  }

  try {
    const summary = await releaseDueCommissions();
    return NextResponse.json({
      ok: true,
      businessTimezone: BUSINESS_TIMEZONE,
      scheduledUtc: `${String(BUSINESS_MIDNIGHT_UTC_HOUR).padStart(2, "0")}:${String(
        BUSINESS_MIDNIGHT_UTC_MINUTE,
      ).padStart(2, "0")}`,
      due: summary.due,
      released: summary.released,
      releasedAmountUsdt: summary.releasedAmountUsdt,
      skipped: summary.skipped,
    });
  } catch (error) {
    /*
     * A failed pass is a 500, for the same reason the other two schedulers
     * are: the scheduler's own failure log is the cheapest monitoring this
     * deployment has, and a release job that has been failing since Tuesday
     * looks exactly like a week with no referrals from the ledger alone.
     */
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "The release pass failed.",
      },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues a GET; POST is accepted so an operator can force a pass. */
export const GET = run;
export const POST = run;
