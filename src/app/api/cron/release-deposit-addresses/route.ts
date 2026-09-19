import { NextResponse, type NextRequest } from "next/server";

import { isCronRequestAuthorised } from "@/server/cron-auth";
import {
  IDLE_RELEASE_MS,
  REASSIGN_QUARANTINE_MS,
  SETTLED_RELEASE_MS,
} from "@/server/services/deposit-address-policy";
import { sweepDepositAddresses } from "@/server/services/deposit-address-sweep.service";
import { withTrace } from "@/server/observability";
import { prunePipelineEvents } from "@/server/services/diagnostics-retention.service";

/**
 * The scheduled deposit-address release.
 *
 * WHY A SCHEDULED URL RATHER THAN A TIMER
 * ---------------------------------------
 * Identical reasoning to `/api/cron/scan-deposits` (CLAUDE.md §18.5). A
 * browser timer is not a source of truth — the tab closes and the address is
 * held forever — and a `setInterval` in a serverless process either never
 * fires or fires once per instance, which with several instances is several
 * concurrent sweeps.
 *
 * WHAT A MISSED RUN COSTS: A DELAY, NOT A LOSS
 * --------------------------------------------
 * Eligibility is a property of the row ("assigned this long ago, no deposit
 * since"), not of the run, so the next successful pass finds everything still
 * outstanding. That is the same design as the commission release (§10d) and
 * the deposit scanner's cursor, and it is what makes an imperfect schedule
 * safe rather than lossy.
 *
 * It is also not the only trigger. `/api/cron/scan-deposits` sweeps at the end
 * of its own pass, and `getOrCreateDepositAddress` sweeps when the pool has
 * nothing to give — so a deployment limited to one cron job a day still
 * recovers capacity at the moment it is needed.
 *
 * TEMPORARY SCHEDULE: DAILY, NOT EVERY 15 MINUTES
 * -----------------------------------------------
 * `vercel.json` schedules this at `0 5 * * *`. It wants `*\/15 * * * *`, which
 * is what it ran at until Vercel's Hobby plan rejected the deploy — Hobby caps
 * every cron at **once per day** and honours the time only to within the hour.
 *
 * Nothing here is unsafe at a daily cadence, because eligibility is a property
 * of the row rather than of the run: the idle and settled windows still mean
 * ten minutes and an hour, and the next pass finds everything that became
 * eligible since the last one. What degrades is only *how long capacity sits
 * unavailable* — an address held by somebody who never paid is returned within
 * a day instead of within fifteen minutes. The two unscheduled triggers above
 * are what keep that from being user-visible, and the sweep on pool exhaustion
 * is the one that matters: it fires at the moment an address is actually
 * needed, with no scheduler involved at all.
 *
 * Restore `*\/15 * * * *` on Pro, or point an external scheduler at this URL.
 * See FUTURE_TASKS "H4".
 *
 * The response echoes the three windows it ran with, so a schedule that has
 * drifted from the policy it enforces is visible in the output rather than
 * only in an environment variable nobody re-reads.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runRelease(request: NextRequest) {
  if (!(await isCronRequestAuthorised(request))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  try {
    const { summary, prune } = await withTrace(
      { route: "/api/cron/release-deposit-addresses", actorType: "system" },
      async () => {
        const swept = await sweepDepositAddresses();

        /*
         * Diagnostics retention rides this job rather than a fifth cron.
         *
         * This route is the one scheduled job that is pure housekeeping — it
         * moves no money, touches no ledger and makes no chain call — so it is
         * the right place for the other piece of housekeeping the platform
         * needs. A fifth cron would be allowed (Hobby permits 100 jobs per
         * project, the same as Pro; only frequency is capped) but would buy
         * nothing: on a daily schedule it would run exactly as often as this.
         *
         * After the sweep and never allowed to fail it: returning an address
         * to the pool is the job somebody is waiting on, and a log table that
         * stays large for another day costs nobody anything. The prune's own
         * instrumentation records why it failed.
         */
        let pruned: Awaited<ReturnType<typeof prunePipelineEvents>> | null = null;
        try {
          pruned = await prunePipelineEvents();
        } catch {
          // Reported as null below rather than swallowed silently.
        }

        return { summary: swept, prune: pruned };
      },
    );

    return NextResponse.json({
      ok: true,
      examined: summary.examined,
      released: summary.released,
      blocked: summary.blocked,
      /*
       * Per-address outcomes, including why each refusal happened.
       *
       * The scheduler's log is the cheapest monitoring this deployment has, and
       * "released 0 of 4" with no reasons is indistinguishable from a sweep
       * that is silently broken. No user identifiers are included — the
       * address and the reason are what an operator needs.
       */
      outcomes: summary.outcomes.map((outcome) => ({
        address: outcome.address,
        released: outcome.released,
        reason: outcome.reason,
        blockedBy: outcome.blockedBy,
      })),
      policy: {
        idleReleaseMs: IDLE_RELEASE_MS,
        settledReleaseMs: SETTLED_RELEASE_MS,
        reassignQuarantineMs: REASSIGN_QUARANTINE_MS,
      },
      // Null when the prune failed; its own instrumentation carries the reason.
      diagnosticsPrune: prune,
    });
  } catch (error) {
    // A 500, so a sweep that has been failing since Tuesday is visible in the
    // scheduler's own failure log rather than only as a pool that is full.
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "The sweep failed.",
      },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues a GET. */
export const GET = runRelease;
/** POST is accepted so an operator can trigger a pass with curl. */
export const POST = runRelease;
