import "server-only";

import { and, asc, eq, gt, lte, sql } from "drizzle-orm";

import { decimalFrom } from "@/db/money";
import { getDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";
import { timestampValue } from "@/db/sql-values";

import { recordInvestmentEarning } from "./wallet.service";
import { matureInvestment } from "./investments-write.service";
import { earningPeriodsFor, elapsedDaysFor, rewardScheduleFor } from "./investment-schedule";
import { SYSTEM_ACTOR } from "../write";

/**
 * The allocation lifecycle's scheduled machinery: earnings, maturity, and the
 * display schedule that describes both.
 *
 * WHAT THIS JOB DOES, IN ORDER
 * -----------------------------
 *  1. **Credits due earnings** (`creditDueEarnings`) — every fixed-term
 *     allocation's own schedule (`investment-schedule.ts`) says exactly which
 *     periods are due and for how much; this calls `recordInvestmentEarning()`
 *     for each one a settlement pass has not yet reached. Non-compounding: a
 *     period's amount always comes from the allocation's original
 *     `projected_profit`, never from a principal a previous period enlarged.
 *  2. **Matures what is due** — hands each allocation past its `matures_at` to
 *     `matureInvestment`, which returns the principal to `available`, releases
 *     it from `locked_in_investments`, writes the ledger entry that explains
 *     the movement and audits it. That function is idempotent (its `UPDATE`
 *     asserts `status = 'active'`), so a job that runs twice, or two jobs
 *     racing, matures it once.
 *  3. **Refreshes the display schedule** — `elapsed_days`, `next_reward_at`
 *     and `next_reward_amount` for everything still running, all recomputed
 *     from `started_at` and the credited-period cursor rather than
 *     incremented. A job that increments drifts when a run is missed; one
 *     that recomputes cannot.
 *
 * Earnings are credited **before** maturity is checked, deliberately: maturity
 * sets `status = 'matured'` and clears the schedule, and an allocation's final
 * period is due exactly *at* `matures_at` (`investment-schedule.ts`'s
 * `earningPeriodsFor`), so crediting it after maturity would find no `active`
 * row left to credit against. Both steps still guard on `status = 'active'` in
 * their own write, so nothing here assumes the order is what makes either one
 * safe — only what makes both of them *complete* in one pass rather than two.
 *
 * WHY THE RATE IS NOW EXACT, NOT A PROJECTION
 * ---------------------------------------------
 * This module used to credit nothing at all, because a plan's
 * `estimated_return_percent` was a point inside a sold *range*
 * (`estimated_return_low`/`high`) and paying `projected_profit ÷ periods` on a
 * schedule would have converted that projection into a guarantee no product
 * decision had made. That decision has since been made: the configured rate is
 * now what the platform actually pays, and `projected_profit` — computed once,
 * at `createInvestment`, from the rate in effect at the moment the allocation
 * was made — is the total this function distributes. The UI still shows the
 * range and still says "estimated"/"projected" (CLAUDE.md §10's language rules
 * are about not promising a guarantee beyond what the product defines, not
 * about whether the number is real), but the number underneath it is now the
 * one the ledger actually moves.
 *
 * FLEXIBLE RESERVE IS EXCLUDED FROM BOTH STEPS
 * -----------------------------------------------
 * `duration_days: 0` has no term for `projected_profit` to be a total *over*,
 * so there is no schedule to credit from — see `isOpenEnded()` and the
 * `gt(durationDays, 0)` filter both steps apply, the same guard that already
 * kept it out of maturity.
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
  /** Earning periods credited across every allocation in this pass. */
  earningsCredited: number;
  /** Allocations that reached maturity in this pass. */
  matured: number;
  /** Allocations already matured by someone else between select and update. */
  alreadyMatured: number;
  errors: string[];
}

export class SettlementUnavailableError extends Error {}

/**
 * Credits every scheduled earning period that has fallen due and has not been
 * credited yet, across active fixed-term allocations.
 *
 * One transaction *per period*, via `recordInvestmentEarning` — not one for
 * the whole pass, and not even one per allocation. An allocation that missed
 * several ticks (a paused cron, a redeploy) may have more than one period due
 * at once, and each is an independent, idempotent money movement; a single bad
 * period must not roll back the ones either side of it, the same reasoning
 * `settleInvestments` already applies to maturity below.
 *
 * Reads `earnings_credited_periods` as the cursor and only ever asks for
 * periods after it, so a long-running daily plan is not re-attempted from
 * period one on every tick once it is caught up — `recordInvestmentEarning`'s
 * own unique index is what makes a *retry* of an already-credited period safe,
 * not a reason to manufacture one on every pass.
 *
 * Bounded to `MAX_PERIODS_PER_INVESTMENT` overdue periods per allocation, per
 * pass. This matters exactly once for any given allocation — the first pass
 * after either the allocation was created or this engine was deployed against
 * an already-running one — and it matters a lot there: a daily allocation
 * several months old with nothing ever credited would otherwise ask this one
 * request to make a hundred-plus sequential transactional writes, which is
 * both slower than the platform's request budget allows and unnecessary,
 * since correctness only requires that the backlog *eventually* clears, not
 * that it clears in one HTTP request. Whatever is left is exactly what the
 * cursor is for: the next pass picks up where this one stopped, and nothing
 * is lost or double-counted either way.
 */
const MAX_PERIODS_PER_INVESTMENT = 60;
async function creditDueEarnings(
  db: ReturnType<typeof getDb>,
  now: Date,
): Promise<{ credited: number; errors: string[] }> {
  const errors: string[] = [];
  let credited = 0;

  const active = await db
    .select({
      id: t.investments.id,
      userId: t.investments.userId,
      planName: t.investments.planName,
      startedAt: t.investments.startedAt,
      maturesAt: t.investments.maturesAt,
      durationDays: t.investments.durationDays,
      rewardFrequency: t.investments.rewardFrequency,
      projectedProfit: t.investments.projectedProfit,
      earningsCreditedPeriods: t.investments.earningsCreditedPeriods,
      scheduleVersion: t.investments.scheduleVersion,
    })
    .from(t.investments)
    .where(
      and(
        eq(t.investments.status, "active"),
        // Flexible Reserve has no term for `projected_profit` to be a total
        // over — the same exclusion `settleInvestments` applies to maturity.
        gt(t.investments.durationDays, 0),
      ),
    )
    .orderBy(asc(t.investments.startedAt))
    .limit(BATCH);

  for (const investment of active) {
    try {
      const periods = earningPeriodsFor({
        startedAt: investment.startedAt,
        maturesAt: investment.maturesAt,
        durationDays: investment.durationDays,
        rewardFrequency: investment.rewardFrequency,
        projectedProfit: decimalFrom(investment.projectedProfit),
        scheduleVersion: investment.scheduleVersion,
      });

      const due = periods
        .filter(
          (period) =>
            period.index > investment.earningsCreditedPeriods && period.dueAt <= now,
        )
        .slice(0, MAX_PERIODS_PER_INVESTMENT);

      for (const period of due) {
        const result = await recordInvestmentEarning(
          {
            investmentId: investment.id,
            userId: investment.userId,
            amount: period.amount,
            periodKey: period.periodKey,
            periodIndex: period.index,
            planName: investment.planName,
          },
          SYSTEM_ACTOR,
        );
        if (result.credited) credited += 1;
      }
    } catch (error) {
      // One allocation's schedule failing to credit must not stop the rest of
      // the batch — the same reasoning `settleInvestments` applies to maturity.
      errors.push(
        `${investment.id}: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }

  return { credited, errors };
}

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
    earningsCredited: 0,
    matured: 0,
    alreadyMatured: 0,
    errors: [],
  };

  /*
   * Earnings, then maturity, then the schedule refresh.
   *
   * An allocation's final earning period is due exactly at `matures_at` (see
   * the module comment), so crediting must run while the row is still
   * `active` — after maturity there is no `active` row left to credit
   * against. Maturity before the schedule refresh is the original ordering:
   * maturing clears `next_reward_at`, and refreshing an allocation that has
   * just matured would recompute a schedule for a row that no longer has one.
   */
  const { credited, errors: earningErrors } = await creditDueEarnings(db, now);
  summary.earningsCredited = credited;
  summary.errors.push(...earningErrors);

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
      earningsCreditedPeriods: t.investments.earningsCreditedPeriods,
      scheduleVersion: t.investments.scheduleVersion,
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
    const schedule = rewardScheduleFor(
      { ...investment, projectedProfit: decimalFrom(investment.projectedProfit) },
      now,
    );

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
