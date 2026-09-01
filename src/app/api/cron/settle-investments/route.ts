import { NextResponse, type NextRequest } from "next/server";

import { isCronRequestAuthorised } from "@/server/cron-auth";
import {
  settleInvestments,
  SettlementUnavailableError,
} from "@/server/services/investment-settlement.service";

/**
 * The scheduled allocation settlement.
 *
 * Same shape and the same secret as `/api/cron/scan-deposits`, for the same
 * reason: a `setInterval` in the server process either never fires or fires
 * once per instance on a platform that freezes instances between requests, and
 * once per instance with several instances is several concurrent settlers.
 *
 * **It returns principal, and pays no rewards.** Maturity moves a locked
 * principal back to `available` through the ledger. Crediting profit needs a
 * rule this codebase does not define — see the note at the top of
 * `investment-settlement.service`.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A pass is bounded to 200 allocations and each maturity is its own
 * transaction, so the ceiling is a few hundred round trips in the worst case
 * and a handful in the ordinary one. Sixty seconds is Vercel's default limit.
 */
export const maxDuration = 60;

async function run(request: NextRequest) {
  if (!(await isCronRequestAuthorised(request))) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  try {
    const summary = await settleInvestments();
    return NextResponse.json({
      ok: summary.errors.length === 0,
      matured: summary.matured,
      alreadyMatured: summary.alreadyMatured,
      refreshed: summary.refreshed,
      errors: summary.errors,
    });
  } catch (error) {
    /*
     * A failed pass is a 500, so the scheduler's own failure log is the
     * cheapest monitoring this deployment has. A settler that has been failing
     * since Tuesday looks exactly like a quiet week from the allocations table.
     */
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof SettlementUnavailableError || error instanceof Error
            ? error.message
            : "The settlement pass failed.",
      },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues a GET; POST is accepted so an operator can trigger a pass. */
export const GET = run;
export const POST = run;
