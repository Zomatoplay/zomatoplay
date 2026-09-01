import "server-only";

import { and, asc, eq, gt, lte, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";
import { timestampValue } from "@/db/sql-values";

import { matureInvestment } from "./investments-write.service";
import { elapsedDaysFor, rewardScheduleFor } from "./investment-schedule";
import { SYSTEM_ACTOR } from "../write";

/**
 * The part of the allocation lifecycle that nothing was running.
 *
 * WHAT WAS MISSING
 * ----------------
 * `createInvestment` and `matureInvestment` were both implemented and correct.
 * Nothing called the second one. So a real allocation was created, took the
 * money, and then froze: `elapsed_days` stayed at whatever it was stamped with,
 * the term progress bar never moved, and the row sat `active` indefinitely past
 * its own `matures_at` with the principal still counted as locked. The money
 * lifecycle stopped one step short of returning anybody's capital.
 *
 * This is the caller. It does two things, both of which are bookkeeping the
 * schema already describes:
 *
 *  1. **Refreshes the schedule** — `elapsed_days`, `next_reward_at` and
 *     `next_reward_amount`, all recomputed from `started_at` rather than
 *     incremented. A job that increments drifts when a run is missed; one that
 *     recomputes cannot. See `./investment-schedule`.
 *  2. **Matures what is due** — hands each allocation past its `matures_at` to
 *     `matureInvestment`, which returns the principal to `available`, releases
 *     it from `locked_in_investments`, writes the ledger entry that explains
 *     the movement and audits it. That function was already idempotent (its
 *     `UPDATE` asserts `status = 'active'`), so a job that runs twice, or two
 *     jobs racing, mature it once.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: CREDIT A REWARD
 * -------------------------------------------------
 * `recordInvestmentEarning()` exists, is idempotent on
 * `(investment_id, period_key)`, and is still called by nothing. That is not an
 * oversight left for later — it is the one rule this codebase does not define.
 *
 * A plan sells an `estimated_return_range`, a *range*, and
 * `estimated_return_percent` is a point inside it. `projected_profit` is
 * therefore a projection, and every screen is required to say so (CLAUDE.md
 * §10: never "guaranteed", always "estimated"/"projected", risk disclosure
 * adjacent). Paying out exactly `projected_profit ÷ periods` on a schedule
 * would convert that projection into a guarantee — a product and compliance
 * decision, not a gap in the plumbing, and one no data in this repository
 * makes.
 *
 * What is missing is a source of truth for what an allocation *actually*
 * earned. When there is one — real strategy performance, or an operator-entered
 * period result — it calls `recordInvestmentEarning()` with that amount and
 * this job is where it belongs. Until then, crediting anything here would be
 * inventing money.
 */

/**
 * How many allocations one pass handles.
 *
 * Bounded so a backlog cannot turn one tick into an unbounded crawl holding a
 * connection — the same reason the chain scanner caps its page walk. Whatever
 * is left is picked up next tick; nothing is lost, because both operations are
 * driven by the row's own state rather than by a cursor.
 */
const BATCH = 200;

export interface SettlementSummary {
  /** Allocations whose schedule was recomputed. */
  refreshed: number;
  /** Allocations that reached maturity in this pass. */
  matured: number;
  /** Allocations already matured by someone else between select and update. */
  alreadyMatured: number;
  errors: string[];
}

export class SettlementUnavailableError extends Error {}

export async function settleInvestments(
  options: { now?: Date } = {},
): Promise<SettlementSummary> {
  if (!isDatabaseConfigured()) {
    throw new SettlementUnavailableError(
      "No DATABASE_URL, so there is nothing to settle.",
    );
  }

  const now = options.now ?? new Date();
  const db = getDb();
  const summary: SettlementSummary = {
    refreshed: 0,
    matured: 0,
    alreadyMatured: 0,
    errors: [],
  };

  /*
   * Maturity first, then the schedule refresh.
   *
   * Order matters: maturing sets `next_reward_at` to null, and refreshing an
   * allocation that has just matured would recompute a schedule for a row that
   * no longer has one. Doing maturity first means the refresh below only ever
   * sees rows that are genuinely still running.
   */
  const due = await db
    .select({ id: t.investments.id })
    .from(t.investments)
    .where(
      and(
        eq(t.investments.status, "active"),
        lte(t.investments.maturesAt, now),
        /*
         * OPEN-ENDED ALLOCATIONS ARE NEVER MATURED BY THIS JOB.
         *
         * This clause is the most important line in the file. Flexible Reserve
         * has `duration_days: 0` and is sold as "no fixed term — funds stay
         * allocated until you withdraw them", so `createInvestment` stamps
         * `matures_at = started_at`. Without this filter every such allocation
         * matches `matures_at <= now` from the second it is created, and the
         * first tick of this job would force the principal back out of a
         * product whose entire selling point is that the *customer* decides
         * when to end it.
         *
         * Returning an open-ended allocation is a user action that does not
         * exist yet — see the report; it is not this job's to invent.
         */
        gt(t.investments.durationDays, 0),
      ),
    )
    // Oldest first, so a backlog drains in the order it accumulated.
    .orderBy(asc(t.investments.maturesAt))
    .limit(BATCH);

  for (const investment of due) {
    try {
      /*
       * One transaction each, deliberately, rather than one for the batch.
       *
       * Each maturity is an independent money movement with its own ledger
       * entry and audit row. Batching them into one transaction would mean a
       * single bad row rolls back every good one — and the guard inside
       * `matureInvestment` already makes retrying the failed one safe.
       */
      const result = await matureInvestment({ investmentId: investment.id }, SYSTEM_ACTOR);
      if (result.matured) summary.matured += 1;
      else summary.alreadyMatured += 1;
    } catch (error) {
      // Recorded and stepped over: one allocation that cannot be settled must
      // not stop the rest of the batch from being settled.
      summary.errors.push(
        `${investment.id}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  const running = await db
    .select({
      id: t.investments.id,
      startedAt: t.investments.startedAt,
      maturesAt: t.investments.maturesAt,
      durationDays: t.investments.durationDays,
      projectedProfit: t.investments.projectedProfit,
      rewardFrequency: t.investments.rewardFrequency,
      elapsedDays: t.investments.elapsedDays,
      nextRewardAt: t.investments.nextRewardAt,
      nextRewardAmount: t.investments.nextRewardAmount,
    })
    .from(t.investments)
    .where(eq(t.investments.status, "active"))
    .orderBy(asc(t.investments.startedAt))
    .limit(BATCH);

  for (const investment of running) {
    const elapsedDays = elapsedDaysFor(investment, now);
    const schedule = rewardScheduleFor(investment, now);

    /*
     * Skipped when nothing would change.
     *
     * Most allocations are unchanged on most ticks — a weekly reward moves once
     * in seven runs — and writing a row to set it to the value it already holds
     * is a round trip spent on nothing. `updated_at` would also move, which
     * would make every allocation look edited every tick in the CRM.
     */
    if (
      investment.elapsedDays === elapsedDays &&
      sameInstant(investment.nextRewardAt, schedule.nextRewardAt) &&
      investment.nextRewardAmount === schedule.nextRewardAmount
    ) {
      continue;
    }

    await db
      .update(t.investments)
      .set({
        elapsedDays,
        nextRewardAt: schedule.nextRewardAt,
        nextRewardAmount: schedule.nextRewardAmount,
        updatedAt: now,
      })
      // Re-asserted, so an allocation matured by a concurrent pass between the
      // select above and this update does not get a schedule written back onto
      // it.
      .where(
        and(
          eq(t.investments.id, investment.id),
          eq(t.investments.status, "active"),
          // `timestampValue`, not the bare Date: a value interpolated into a
          // `sql` fragment gets no column type mapper. See `@/db/sql-values`.
          sql`${t.investments.startedAt} = ${timestampValue(investment.startedAt)}`,
        ),
      );

    summary.refreshed += 1;
  }

  return summary;
}

/** Two nullable timestamps that describe the same moment (or both nothing). */
function sameInstant(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b;
  return a.getTime() === b.getTime();
}
