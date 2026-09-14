import "server-only";

import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";

import {
  countUnresolvedDeposits,
  releaseDepositAddress as releaseDepositAddressRow,
  AddressReleaseError,
} from "../repositories/deposit-address.repository";
import {
  IDLE_RELEASE_MS,
  RELEASE_REASON_LABELS,
  SETTLED_RELEASE_MS,
  type ReleaseReason,
} from "./deposit-address-policy";
import { recordPipelineEvent, trackPipeline } from "../observability";
import { mutate, SYSTEM_ACTOR } from "../write";

/**
 * Returning idle and settled deposit addresses to the pool.
 *
 * WHY THIS EXISTS
 * ---------------
 * An assignment used to be permanent until an operator undid it by hand. With
 * a pool of one or two addresses — which is what a deployment that has not yet
 * generated more actually has — that means the first account to open the
 * deposit screen takes the only address and keeps it forever, and every
 * account after it is told "could not get your deposit address". Observed on
 * this project on 2026-09-14: three pool rows, two retired, one assigned, zero
 * available.
 *
 * WHY IT IS SAFE, WHICH IS THE PART THAT MATTERS
 * ----------------------------------------------
 * Releasing an address is only dangerous if a later transfer can be credited
 * to the wrong person. Three things make that unrepresentable, and none of
 * them is a timer:
 *
 *  1. **Attribution is by assignment interval.** A transfer belongs to
 *     whoever held the address at the transfer's own block timestamp, not to
 *     whoever holds it now (`findOwnerOfAddressAt`). Releasing an address
 *     cannot retroactively move a deposit.
 *  2. **A transfer in a gap goes to the operator queue.** If nobody held the
 *     address at that instant, the deposit is recorded unattributed and
 *     credits nobody. Slow and correct.
 *  3. **Quarantine keeps a released address away from a *different* user** for
 *     `REASSIGN_QUARANTINE_MS`. The previous holder may take it straight back,
 *     which carries no risk at all.
 *
 * And the pre-existing refusal is untouched: an address with a `pending`,
 * `confirming` or unattributed `confirmed` deposit is not released by this
 * sweep or by an operator, at any age.
 *
 * WHY IT IS NOT A TIMER IN THE SERVER PROCESS, OR IN A BROWSER
 * ------------------------------------------------------------
 * The same reasoning as the deposit scanner (CLAUDE.md §18.5). A browser timer
 * is not a source of truth — the tab closes and the address is held forever. A
 * `setInterval` in a serverless process either never fires or fires once per
 * instance. So this is a plain function with three callers:
 *
 *   - `/api/cron/release-deposit-addresses`, the scheduled server-side pass;
 *   - the end of `/api/cron/scan-deposits`, so the existing schedule catches
 *     up too and a deployment that can only run one cron job still works;
 *   - `getOrCreateDepositAddress`, **when the pool has nothing available** —
 *     which makes the pool self-healing even with no scheduler configured at
 *     all, at the exact moment the capacity is needed.
 *
 * It is idempotent and restartable. A missed run is a delay, never a loss:
 * eligibility is "this address has been idle since `assigned_at`", which stays
 * true until it is acted on, exactly like the commission release's
 * `release_at <= now` (CLAUDE.md §10d).
 */

export interface SweepOutcome {
  addressId: string;
  address: string;
  userId: string | null;
  released: boolean;
  reason: ReleaseReason | null;
  /** Why it was left alone. Null when it was released. */
  blockedBy: string | null;
}

export interface SweepSummary {
  examined: number;
  released: number;
  blocked: number;
  outcomes: SweepOutcome[];
}

interface Candidate {
  id: string;
  address: string;
  userId: string | null;
  assignedAt: Date | null;
  /** The most recent `updated_at` across this address's deposits, if any. */
  lastDepositAt: string | Date | null;
  depositCount: number;
}

/** Whatever the driver handed back for a timestamp, as a `Date`. */
function asDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Whether an assignment has earned its release, and under which rule.
 *
 * Pure, and exported so the decision can be tested exhaustively at its
 * boundaries without a database, a clock or a chain — the same treatment the
 * plan rate ladder gets.
 *
 * The order is deliberate: unresolved activity refuses *first* and at any age,
 * so no amount of elapsed time can talk the sweep past it.
 */
export function releaseDecision(
  candidate: {
    assignedAt: Date | null;
    lastDepositAt: Date | null;
    depositCount: number;
    unresolvedDeposits: number;
  },
  now: Date,
): { release: false; blockedBy: string } | { release: true; reason: ReleaseReason } {
  if (candidate.unresolvedDeposits > 0) {
    const n = candidate.unresolvedDeposits;
    return {
      release: false,
      blockedBy: `${n} unresolved deposit${n === 1 ? "" : "s"} against this address`,
    };
  }

  /*
   * An assignment with no `assigned_at` cannot be aged, so it is never
   * released by the clock. A null here means a row this code did not write,
   * and inventing a start date for it would be inventing the moment somebody's
   * address becomes somebody else's — the same refusal the commission release
   * makes for a null `release_at` (CLAUDE.md §10).
   */
  if (!candidate.assignedAt) {
    return { release: false, blockedBy: "no assignment timestamp to age from" };
  }

  const heldFor = now.getTime() - candidate.assignedAt.getTime();

  if (candidate.depositCount === 0) {
    if (heldFor >= IDLE_RELEASE_MS) return { release: true, reason: "idle_timeout" };
    return {
      release: false,
      blockedBy: `assigned ${Math.round(heldFor / 1000)}s ago; the idle window is ${Math.round(
        IDLE_RELEASE_MS / 1000,
      )}s`,
    };
  }

  /*
   * Every deposit is terminal, so the question is only whether more are
   * likely. Measured from the *last* deposit rather than from the assignment:
   * somebody who deposited two minutes ago is the person most likely to
   * deposit again, and ageing from `assigned_at` would cut them off mid-stream
   * on a long-held address.
   */
  const since = candidate.lastDepositAt
    ? now.getTime() - candidate.lastDepositAt.getTime()
    : heldFor;
  if (since >= SETTLED_RELEASE_MS) return { release: true, reason: "settled" };
  return {
    release: false,
    blockedBy: `last deposit activity ${Math.round(since / 1000)}s ago; the settle window is ${Math.round(
      SETTLED_RELEASE_MS / 1000,
    )}s`,
  };
}

/**
 * One pass over the assigned addresses.
 *
 * Each release is **its own transaction**, deliberately. One transaction for
 * the whole sweep would make a single refusal roll back every release that had
 * already succeeded, and would hold a write transaction open across an
 * unbounded number of addresses on a five-connection pool. Independent units
 * also mean two passes overlapping cannot deadlock on each other: each takes
 * one row's lock, briefly.
 */
export async function sweepDepositAddresses(
  options: { now?: Date; limit?: number } = {},
): Promise<SweepSummary> {
  if (!isDatabaseConfigured()) {
    return { examined: 0, released: 0, blocked: 0, outcomes: [] };
  }

  return trackPipeline(
    {
      pipeline: "deposit",
      operation: "deposit.address.sweep",
      message: "Sweeping deposit addresses for release",
    },
    () => runSweep(options),
  );
}

async function runSweep(options: {
  now?: Date;
  limit?: number;
}): Promise<SweepSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 200;
  const db = getDb();

  /*
   * One query for the whole candidate set: assigned rows, with their deposit
   * activity rolled up. The alternative — read the addresses, then a deposits
   * query per address — is the N+1 this codebase already pays ~200ms a round
   * trip to avoid.
   *
   * Oldest assignment first, so a long-held address is freed before a fresh
   * one when `limit` truncates the set.
   */
  const candidates: Candidate[] = await db
    .select({
      id: t.depositAddresses.id,
      address: t.depositAddresses.address,
      userId: t.depositAddresses.userId,
      assignedAt: t.depositAddresses.assignedAt,
      depositCount: sql<number>`(
        select count(*)::int from ${t.deposits}
        where ${t.deposits.walletAddress} = ${t.depositAddresses.address}
      )`,
      /*
       * Typed as a string, and converted below — deliberately.
       *
       * Drizzle applies a column's type mapper to `.select()` fields that name
       * a column; it cannot apply one to a raw `sql` fragment, because a
       * fragment has no column to take the type from (the same hazard
       * `@/db/sql-values` documents from the other direction). postgres.js
       * therefore hands this back as text, and declaring it `Date` made the
       * whole sweep throw `TypeError: lastDepositAt.getTime is not a function`
       * — which `sweepOne` caught and reported as "the release could not be
       * completed" for every address that had ever received anything.
       */
      lastDepositAt: sql<string | null>`(
        select max(${t.deposits.updatedAt}) from ${t.deposits}
        where ${t.deposits.walletAddress} = ${t.depositAddresses.address}
      )`,
    })
    .from(t.depositAddresses)
    .where(
      and(
        eq(t.depositAddresses.status, "assigned"),
        isNotNull(t.depositAddresses.userId),
        // Only rows old enough that the *shortest* window could have elapsed.
        // Everything younger is certainly ineligible, so there is no reason to
        // fetch its deposit rollup.
        lte(
          t.depositAddresses.assignedAt,
          new Date(now.getTime() - IDLE_RELEASE_MS),
        ),
      ),
    )
    .orderBy(asc(t.depositAddresses.assignedAt))
    .limit(limit);

  const outcomes: SweepOutcome[] = [];

  for (const candidate of candidates) {
    const outcome = await sweepOne(candidate, now);
    outcomes.push(outcome);
  }

  const released = outcomes.filter((o) => o.released).length;
  return {
    examined: candidates.length,
    released,
    blocked: outcomes.length - released,
    outcomes,
  };
}

async function sweepOne(candidate: Candidate, now: Date): Promise<SweepOutcome> {
  const base = {
    addressId: candidate.id,
    address: candidate.address,
    userId: candidate.userId,
  };

  try {
    return await mutate(SYSTEM_ACTOR, async ({ tx, now: txNow, audit }) => {
      /*
       * The unresolved count is re-read **inside the transaction**, not taken
       * from the rollup above.
       *
       * The rollup is a snapshot from before this row's lock was taken, and a
       * deposit can be recorded between the two. Deciding on the stale number
       * is exactly the race the safety rule exists to prevent — so the
       * authoritative read happens here, and `releaseDepositAddress` asserts
       * it again in its own guard. Belt and braces, on the one decision where
       * being wrong moves somebody else's money.
       */
      const unresolved = await countUnresolvedDeposits(tx, candidate.address);
      const decision = releaseDecision(
        {
          assignedAt: asDate(candidate.assignedAt),
          lastDepositAt: asDate(candidate.lastDepositAt),
          depositCount: candidate.depositCount,
          unresolvedDeposits: unresolved,
        },
        now,
      );

      if (!decision.release) {
        return { ...base, released: false, reason: null, blockedBy: decision.blockedBy };
      }

      const released = await releaseDepositAddressRow(
        tx,
        candidate.id,
        txNow,
        decision.reason,
      );

      audit({
        action: "deposit_address_released",
        target: { type: "deposit", id: released.id, label: released.address },
        details:
          `Automatically released deposit address ${released.address} back to ` +
          `the pool: ${RELEASE_REASON_LABELS[decision.reason]}. It is withheld ` +
          `from any other account until the quarantine window passes, and a ` +
          `transfer that arrives meanwhile is attributed to whoever held the ` +
          `address when it was sent.`,
      });

      return {
        ...base,
        released: true,
        reason: decision.reason,
        blockedBy: null,
      };
    });
  } catch (error) {
    /*
     * One address failing must not stop the pass.
     *
     * `AddressReleaseError` is the expected case — a deposit arrived between
     * the rollup and the lock — and is recorded as a refusal rather than as a
     * fault. Anything else is recorded as a failure and the sweep continues,
     * because a pool with one unreleasable row is still better served by
     * releasing the other nine than by aborting.
     */
    const blockedBy =
      error instanceof AddressReleaseError
        ? error.message
        : "the release could not be completed";

    recordPipelineEvent({
      pipeline: "deposit",
      operation: "deposit.address.sweep.skipped",
      status: error instanceof AddressReleaseError ? "ok" : "failed",
      message: `Deposit address ${candidate.address} was not released`,
      subject: { type: "deposit_address", id: candidate.id },
      errorMessage: error instanceof Error ? `${error.name}: ${error.message}` : null,
    });

    return { ...base, released: false, reason: null, blockedBy };
  }
}
