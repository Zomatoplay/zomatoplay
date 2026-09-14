import "server-only";

import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";

import { add, decimalFrom, isPositive, numericValue, ZERO, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import { getDb, type Tx } from "@/db";

import { applyLedgerEntry, ensureWallet } from "../repositories/wallet.repository";
import { resilientRead } from "../database";
import { businessMidnightUtc } from "@/lib/business-time";
import { mutate, newId, withReason, SYSTEM_ACTOR, type Actor } from "../write";

/**
 * The referral programme's write side: what an allocation earns the people who
 * introduced the person who made it.
 *
 * WHY THIS EXISTS NOW
 * -------------------
 * Everything up to here already worked. A link carries `?ref=`, the middleware
 * stores it, account creation resolves it into a `referrals` row, and the
 * referral screen reads the result. What nothing did was the middle of the
 * chain the product describes to the user in `referralSteps`:
 *
 *     They invest in a plan → commission is calculated on the amount they
 *     allocate → you earn commission
 *
 * Without it every referral stayed `registered` for ever, `activeReferrals` and
 * `teamVolumeUsdt` stayed zero, so VIP progression could never move, and the
 * commission ledger stayed empty. The referral page rendered a correct picture
 * of a programme that did nothing.
 *
 * THE RULES ARE READ, NOT INVENTED
 * --------------------------------
 * Every number here comes from somewhere that already existed:
 *
 * - the rate is `vip_levels.tier1/tier2_commission_percent`, looked up against
 *   the **beneficiary's** current level — which is what the VIP card promises
 *   ("higher levels earn a larger share of your team's allocations");
 * - the base is the allocation amount, which is what `referralSteps` says;
 *   and the schema comment on `commission_entries` says in as many words that
 *   a real referral service writes these "when an allocation settles";
 * - two tiers, because the VIP table defines two and the `tier` column is a
 *   `smallint` holding 1 or 2. There is no third tier to walk to.
 *
 * WHAT IS DELIBERATELY NOT DONE HERE: NO MONEY MOVES
 * --------------------------------------------------
 * Entries are written `pending` and land in `commission_pending_usdt`, which is
 * what the referral screen shows as "pending". Nothing touches `available` and
 * no ledger entry is written.
 *
 * Crediting is a **separate, scheduled** step: each entry carries a
 * `release_at` stamped here from the operator's `payoutDelayDays`, and
 * `releaseDueCommissions()` — driven nightly by
 * `/api/cron/release-commissions` — pays the ones whose time has come. An
 * operator can still release one by hand from `/admin/referrals`, and the two
 * routes call the same guarded function, so they cannot pay the same entry
 * twice.
 *
 * The separation is not ceremony. An accrual is mechanical — an allocation
 * happened, so a commission is owed — while a payment is a movement of money
 * to a third party, and this codebase puts every one of those behind an
 * explicit, audited, idempotent step rather than inside the transaction that
 * caused it.
 *
 * ARITHMETIC
 * ----------
 * Every multiplication happens in Postgres against `numeric`. Nothing here adds
 * or multiplies money in JavaScript — see CLAUDE.md §17.2 — and the amounts
 * that cross this boundary are `Decimal`, bound through `numericValue()`.
 */

/**
 * The ceiling on how far up the chain a commission can reach.
 *
 * The *operator's* setting (`platform_settings.referrals.maxTiers`) decides how
 * far it actually reaches; this is the hard bound, and it exists because the VIP
 * table defines exactly two commission columns. A `maxTiers` of 3 would have no
 * rate to apply, so it is clamped rather than trusted.
 */
const MAX_TIER = 2;

export interface CommissionAccrual {
  tier: 1 | 2;
  beneficiaryUserId: string;
  commissionEntryId: string;
}

/**
 * Records the commission an allocation generates, and moves the referral
 * aggregates that describe it.
 *
 * Called from inside `createInvestment`'s transaction, so an allocation and the
 * commission it earned either both exist or neither does. A commission entry
 * whose allocation rolled back would be an unbacked promise of money.
 *
 * Idempotent by construction rather than by a key: it runs once per allocation,
 * inside the transaction that creates that allocation, and nothing in this
 * codebase retries a write (CLAUDE.md §16.8 — `resilientRead` is reads only).
 *
 * Returns what it wrote so the caller can audit it. An empty array means the
 * investor was not referred by anybody, which is the common case.
 */
export async function accrueReferralCommission(
  tx: Tx,
  request: {
    investorUserId: string;
    investorName: string;
    planName: string;
    amount: Decimal;
    now: Date;
  },
): Promise<CommissionAccrual[]> {
  const accruals: CommissionAccrual[] = [];

  /*
   * The programme's own switches, read from the row the CRM writes.
   *
   * `/admin/settings` has offered `programmeEnabled` and `maxTiers` since before
   * any of this existed, and nothing read either of them: an operator could
   * switch the referral programme off, watch the toggle save, and commission
   * would keep accruing. A setting the product ignores is worse than a setting
   * that is not there, because it tells an operator a decision was taken.
   *
   * Read inside the transaction, so an allocation and the rules it was judged
   * against cannot disagree.
   */
  const [settings] = await tx
    .select({ referrals: t.platformSettings.referrals })
    .from(t.platformSettings)
    .where(eq(t.platformSettings.id, "default"))
    .limit(1);

  // Absent settings row: the programme's documented default is on, and this
  // must not silently stop paying people because a configuration row is missing.
  const programmeEnabled = settings?.referrals?.programmeEnabled ?? true;
  if (!programmeEnabled) return accruals;

  const maxTier = Math.min(
    Math.max(Math.trunc(settings?.referrals?.maxTiers ?? MAX_TIER), 1),
    MAX_TIER,
  );

  /*
   * WHEN THIS COMMISSION BECOMES PAYABLE, DECIDED ONCE, HERE.
   *
   * The delay is the operator's `payoutDelayDays`, and the boundary is
   * midnight on the business calendar (`./business-time`) — so an entry
   * accrued at any time on the 13th with a three-day delay becomes payable at
   * 00:00 IST on the 16th, and every entry accrued that day shares a date a
   * person can be told. Adding the delay to the accrual *instant* instead
   * would make two allocations minutes apart pay out on different days, which
   * is a worse thing to have to explain than a fixed boundary.
   *
   * Stamped now rather than applied at release time, so an operator changing
   * the delay later cannot move money that was already promised a date — see
   * the column comment on `commission_entries.release_at`.
   *
   * `payoutDelayDays` of 0 means the next midnight: a delay of zero days is
   * "tonight's run", never "immediately", because the release is a nightly job
   * and pretending otherwise would put a date in the past on a fresh entry.
   */
  const delayDays = Math.max(
    Math.trunc(settings?.referrals?.payoutDelayDays ?? 0),
    0,
  );
  const releaseAt = businessMidnightUtc(request.now, Math.max(delayDays, 1));

  // The direct edge first, then that person's own direct edge. Two lookups,
  // bounded — never a loop over a chain a cycle could make infinite.
  let childUserId = request.investorUserId;

  for (let tier = 1; tier <= maxTier; tier += 1) {
    const edge = await findDirectReferrer(tx, childUserId);
    if (!edge) break;

    const percent = tier === 1 ? edge.tier1Percent : edge.tier2Percent;

    /*
     * The commission, computed by Postgres and rounded to the column's scale.
     *
     * `round(…, 8)` rather than letting the insert truncate: `usdt` is
     * `numeric(20, 8)`, and an unrounded product of an amount and a
     * four-decimal percentage can carry twelve decimal places. Postgres would
     * round on assignment anyway; doing it explicitly means the value written
     * to the entry and the value added to the aggregate are the same digits
     * rather than two roundings that could disagree by a unit in the last
     * place.
     */
    const amountSql = sql`round(${numericValue(request.amount)} * ${String(percent)}::numeric / 100, 8)`;

    const commissionEntryId = newId("com", request.now);
    await tx.insert(t.commissionEntries).values({
      id: commissionEntryId,
      beneficiaryUserId: edge.referrerUserId,
      sourceUserId: request.investorUserId,
      // Copied, not joined: a ledger line has to keep reading correctly after
      // the account it names is renamed or removed.
      sourceUserName: request.investorName,
      tier,
      amountUsdt: amountSql,
      sourcePlanName: request.planName,
      createdAt: request.now,
      // The enum's own default. Nothing here credits a wallet — see above.
      status: "pending",
      // The schedule this entry was accrued under, not a rule re-derived later.
      releaseAt,
    });

    /*
     * The same expression, evaluated again, rather than the value read back.
     *
     * `usdt` columns are `mode: "number"`, so a `.returning()` would hand back
     * a JavaScript float and binding it into the next statement would put
     * binary floating point in the middle of a money path — the one thing
     * CLAUDE.md §17.2 forbids. Postgres evaluates `amountSql` from exact
     * numerics both times and gets the same digits, so recomputing is both
     * cheaper and more correct than a round trip through `number`.
     */
    const earned = amountSql;

    /*
     * The direct edge is the only one with a `referrals` row to update.
     *
     * A tier-2 beneficiary has no row pointing at this investor — the table
     * stores the direct edge, which is why `referral_accounts` carries
     * `indirect_referrals` separately. So tier 2 moves the aggregates and the
     * ledger and nothing else, which is exactly what the CRM's referral screen
     * expects to read.
     */
    const becameActive = tier === 1 && edge.referralStatus !== "active";
    if (tier === 1) {
      await tx
        .update(t.referrals)
        .set({
          investedAmount: sql`${t.referrals.investedAmount} + ${numericValue(request.amount)}`,
          earnedFromReferral: sql`${t.referrals.earnedFromReferral} + ${earned}`,
          // `registered` means "signed up and done nothing". An allocation is
          // the activity the word `active` describes, and the VIP thresholds
          // are counted in exactly these.
          status: "active",
        })
        .where(eq(t.referrals.id, edge.referralId));
    }

    await tx
      .insert(t.referralAccounts)
      .values({
        userId: edge.referrerUserId,
        activeReferrals: becameActive ? 1 : 0,
        teamVolumeUsdt: numericValue(request.amount),
        commissionPendingUsdt: earned,
        joinedAt: request.now,
        updatedAt: request.now,
      })
      .onConflictDoUpdate({
        target: t.referralAccounts.userId,
        set: {
          // Counted once, on the transition. A referral's second allocation
          // must not make them two active referrals — and the `for update` in
          // `findDirectReferrer` is what makes that hold when two allocations
          // by the same person land at the same moment.
          activeReferrals: becameActive
            ? sql`${t.referralAccounts.activeReferrals} + 1`
            : t.referralAccounts.activeReferrals,
          teamVolumeUsdt: sql`${t.referralAccounts.teamVolumeUsdt} + ${numericValue(request.amount)}`,
          commissionPendingUsdt: sql`${t.referralAccounts.commissionPendingUsdt} + ${earned}`,
          updatedAt: request.now,
        },
      });

    /*
     * Promotion, immediately after the numbers it depends on have moved.
     *
     * `active_referrals` and `team_volume_usdt` are the two VIP requirements,
     * and until this transaction existed neither ever changed — so nobody could
     * be promoted and `nextLevelProgress` on the referral screen was a bar that
     * could only ever read 0%. Now that they move, something has to act on them
     * or the screen promises a level the account can never reach.
     *
     * Deliberately *after* the commission above, so this allocation pays at the
     * rate the beneficiary held when it was made and the new rate applies to
     * the next one. Promoting first would retroactively reprice the allocation
     * that caused the promotion.
     */
    await promoteVipLevel(tx, edge.referrerUserId, request.now);

    accruals.push({
      tier: tier as 1 | 2,
      beneficiaryUserId: edge.referrerUserId,
      commissionEntryId,
    });

    // Walk one level up for the next tier.
    childUserId = edge.referrerUserId;
  }

  return accruals;
}

interface DirectEdge {
  referralId: string;
  referralStatus: string;
  referrerUserId: string;
  tier1Percent: number;
  tier2Percent: number;
}

/**
 * Who directly introduced this account, and at what rates they currently earn.
 *
 * One statement, joining the referrer and their VIP level, because a round trip
 * to this database costs ~200ms and three statements here would be three of
 * them inside a transaction holding a connection (CLAUDE.md §16.1a item 2).
 *
 * `for update`, and specifically `of` the `referrals` row alone. The status
 * read here decides whether `active_referrals` is incremented, so two
 * allocations by the same person arriving together would both see `registered`
 * and both count — a check-then-act race of exactly the kind CLAUDE.md §17.5
 * refuses everywhere else. Locking the edge serialises them, and the second
 * transaction reads the committed `active`.
 *
 * `of` matters as much as the lock: without it Postgres would also lock the
 * joined `vip_levels` row, which is one shared configuration row per level and
 * would serialise every allocation on the platform behind it.
 */
async function findDirectReferrer(
  tx: Tx,
  referredUserId: string,
): Promise<DirectEdge | null> {
  const [row] = await tx
    .select({
      referralId: t.referrals.id,
      referralStatus: t.referrals.status,
      referrerUserId: t.referrals.referrerUserId,
      tier1Percent: t.vipLevels.tier1CommissionPercent,
      tier2Percent: t.vipLevels.tier2CommissionPercent,
    })
    .from(t.referrals)
    .innerJoin(t.users, eq(t.users.id, t.referrals.referrerUserId))
    .innerJoin(t.vipLevels, eq(t.vipLevels.id, t.users.vipLevel))
    .where(eq(t.referrals.referredUserId, referredUserId))
    .limit(1)
    .for("update", { of: t.referrals });

  return row ?? null;
}

/**
 * Moves an account up to the highest VIP level it now qualifies for.
 *
 * THE RULE IS READ, NOT INVENTED
 * ------------------------------
 * `vip_levels` carries `required_active_referrals` and
 * `required_team_volume_usdt` per level, and the referral screen already
 * computes progress as the *lesser* of the two ratios — which is to say both
 * requirements must be met. This applies exactly that test, walking the levels
 * in `sort_order` and taking the highest one satisfied.
 *
 * PROMOTION ONLY, NEVER DEMOTION
 * ------------------------------
 * Nothing here can lower a level, and that is deliberate rather than
 * unfinished. A level is a rate somebody has been earning at; taking it away
 * because a referral went quiet would reprice a relationship after the fact,
 * and no rule anywhere in this codebase or its configuration defines when that
 * should happen. If demotion is ever wanted it needs its own decision, its own
 * audit entry and its own notice to the person — not a side effect of somebody
 * else's allocation.
 *
 * The `UPDATE` is guarded on the level it read, so two allocations landing
 * together cannot promote twice or fight over the result.
 */
async function promoteVipLevel(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<void> {
  const [account] = await tx
    .select({
      vipLevel: t.users.vipLevel,
      activeReferrals: t.referralAccounts.activeReferrals,
      teamVolumeUsdt: t.referralAccounts.teamVolumeUsdt,
    })
    .from(t.users)
    .innerJoin(t.referralAccounts, eq(t.referralAccounts.userId, t.users.id))
    .where(eq(t.users.id, userId))
    .limit(1);

  if (!account) return;

  const levels = await tx
    .select({
      id: t.vipLevels.id,
      requiredActiveReferrals: t.vipLevels.requiredActiveReferrals,
      requiredTeamVolumeUsdt: t.vipLevels.requiredTeamVolumeUsdt,
    })
    .from(t.vipLevels)
    .orderBy(asc(t.vipLevels.sortOrder));

  const currentIndex = levels.findIndex((level) => level.id === account.vipLevel);
  let earned = account.vipLevel;

  // Walk up from where they are. Starting at the bottom could only ever
  // reproduce the same answer, and starting above them is what makes this
  // promotion-only by construction rather than by a comparison afterwards.
  for (let i = Math.max(currentIndex, 0) + 1; i < levels.length; i += 1) {
    const level = levels[i];
    const meetsReferrals =
      account.activeReferrals >= level.requiredActiveReferrals;
    const meetsVolume = account.teamVolumeUsdt >= level.requiredTeamVolumeUsdt;
    // Both, not either — the same test the progress bar shows.
    if (!meetsReferrals || !meetsVolume) break;
    earned = level.id;
  }

  if (earned === account.vipLevel) return;

  await tx
    .update(t.users)
    .set({ vipLevel: earned, updatedAt: now })
    // Re-asserted, so a concurrent allocation cannot promote the same account
    // twice or overwrite a higher level with a lower one.
    .where(and(eq(t.users.id, userId), eq(t.users.vipLevel, account.vipLevel)));
}

/* -------------------------------------------------------------------------- */
/* Releasing commission                                                        */
/* -------------------------------------------------------------------------- */

export class ReferralError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferralError";
  }
}

/**
 * Pays a pending commission entry into the beneficiary's wallet.
 *
 * TWO TRIGGERS, ONE FUNCTION
 * --------------------------
 * The nightly release job calls this, and so does an operator pressing
 * *Release* in `/admin/referrals`. Deliberately the same function and not two
 * that happen to agree: the money path, the ledger entry, the aggregate move
 * and the audit line are written once, so a hand release and a scheduled one
 * cannot drift, and — because the guard below is a condition in the `UPDATE`
 * rather than a prior read — the two racing each other pay exactly once.
 *
 * The actor differs and is recorded: `SYSTEM_ACTOR` for the scheduler, the
 * operator for a manual release. An audit line that could not say which is an
 * audit line worth nothing.
 *
 * WHAT MAKES IT SAFE TO RUN TWICE
 * -------------------------------
 * The status transition is asserted in the `UPDATE`'s own `WHERE`, not checked
 * beforehand, so two operators clicking at once produce one payment
 * (CLAUDE.md §17.5). If the guarded update matches no row, nothing is credited
 * and the caller is told why.
 */
export async function releaseCommission(
  request: { commissionEntryId: string; note?: string },
  actor: Actor,
): Promise<{ amount: Decimal; beneficiaryUserId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const [entry] = await tx
      .select()
      .from(t.commissionEntries)
      .where(eq(t.commissionEntries.id, request.commissionEntryId))
      .limit(1)
      .for("update");

    if (!entry) {
      throw new ReferralError("That commission entry no longer exists.");
    }
    if (entry.status === "credited") {
      throw new ReferralError("That commission has already been paid.");
    }
    if (entry.status === "reversed") {
      throw new ReferralError("That commission was reversed and cannot be paid.");
    }

    const amount = decimalFrom(entry.amountUsdt);
    if (!isPositive(amount)) {
      throw new ReferralError("That commission entry is for zero.");
    }

    await ensureWallet(tx, entry.beneficiaryUserId);

    /*
     * The only place a referral commission becomes money.
     *
     * `applyLedgerEntry` is the single writer of a balance in this application
     * and always writes the transaction row that explains it, which is what
     * keeps the ledger summing to the balance (CLAUDE.md §17.3). The reference
     * is the commission entry, so the ledger line and the referral screen point
     * at each other.
     */
    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: entry.beneficiaryUserId,
      type: "referral",
      amount,
      description: `Referral commission · tier ${entry.tier} · ${entry.sourceUserName}`,
      reference: entry.id,
      occurredAt: now,
      buckets: { totalProfit: amount },
    });

    const paid = await tx
      .update(t.commissionEntries)
      .set({ status: "credited", releasedAt: now })
      // The guard, not a prior read: two operators releasing the same entry at
      // the same moment must produce one payment.
      .where(
        and(
          eq(t.commissionEntries.id, entry.id),
          eq(t.commissionEntries.status, "pending"),
        ),
      )
      .returning({ id: t.commissionEntries.id });

    if (paid.length === 0) {
      throw new ReferralError("That commission was already paid by someone else.");
    }

    /*
     * The aggregate follows the entry: pending falls, earned rises, by the same
     * amount, in the same transaction. `greatest(…, 0)` because these two
     * counters are a cache of the ledger rather than the ledger itself — a
     * historical row that predates this accrual path could otherwise drive
     * `pending` negative, and a negative "pending commission" on the user's
     * referral screen is worse than a floor.
     */
    await tx
      .update(t.referralAccounts)
      .set({
        commissionPendingUsdt: sql`greatest(${t.referralAccounts.commissionPendingUsdt} - ${numericValue(amount)}, 0)`,
        commissionEarnedUsdt: sql`${t.referralAccounts.commissionEarnedUsdt} + ${numericValue(amount)}`,
        updatedAt: now,
      })
      .where(eq(t.referralAccounts.userId, entry.beneficiaryUserId));

    audit({
      action: "user_updated",
      target: {
        type: "user",
        id: entry.beneficiaryUserId,
        label: entry.sourceUserName,
      },
      details: withReason(
        `Released ${amount} USDT of tier ${entry.tier} referral commission ` +
          `(entry ${entry.id}, ledger ${ledgerTxId}).`,
        request.note,
      ),
    });

    return { amount, beneficiaryUserId: entry.beneficiaryUserId };
  });
}

/* -------------------------------------------------------------------------- */
/* The nightly release pass                                                    */
/* -------------------------------------------------------------------------- */

export interface CommissionReleaseSummary {
  /** How many entries were found due at the moment the pass started. */
  due: number;
  released: number;
  releasedAmountUsdt: Decimal;
  /**
   * Entries that were due and were not paid, with the reason. Almost always
   * "somebody else paid it first", which is a success of the guard rather than
   * a failure of the pass — and is reported rather than hidden so a pass that
   * is failing for a *real* reason does not look like a quiet night.
   */
  skipped: Array<{ commissionEntryId: string; reason: string }>;
}

/**
 * Pays every pending commission whose release time has arrived.
 *
 * ELIGIBILITY IS `release_at <= now`, NOT "TODAY IS THE DAY"
 * ----------------------------------------------------------
 * The schedule runs at midnight on the business calendar, but eligibility is
 * deliberately not tied to the run happening then. If the scheduler is down at
 * 00:00 and the next successful pass is at 01:17 — or the following night —
 * every entry whose moment has passed is still found, because the question
 * asked is "is it due" and not "did it become due during this run". Nothing is
 * lost by a missed run; it is late, which is the failure mode a polling design
 * is chosen for (the same reasoning as the deposit scanner, CLAUDE.md §18.5).
 *
 * A `release_at` of null is **not** due, ever. Those are entries accrued
 * before the column existed, and no rule says when they should be paid;
 * inventing one for them would be putting a date on somebody's money after the
 * fact. They stay in the operator's queue.
 *
 * WHY RELEASES ARE ONE TRANSACTION EACH, NOT ONE BIG ONE
 * ------------------------------------------------------
 * Each `releaseCommission` is its own transaction, so a pass that fails
 * halfway keeps every payment it has already made and the next run resumes
 * from what is still pending. One large transaction would roll back paid
 * commissions on an unrelated failure, and would hold a connection out of a
 * five-connection pool for the length of the whole pass (CLAUDE.md §16.1a).
 *
 * WHY RUNNING IT TWICE IS SAFE
 * ----------------------------
 * The due list is a *read*. What actually pays is `releaseCommission`, whose
 * status transition is asserted in the `UPDATE`'s own `WHERE` clause — so two
 * overlapping passes, or a pass overlapping an operator's manual release, both
 * try and exactly one succeeds; the loser gets "already paid" and is reported
 * as skipped. There is no check-then-act window anywhere in this path, which
 * is the property CLAUDE.md §17.5 requires of anything that moves money.
 */
export async function releaseDueCommissions(
  options: { now?: Date; limit?: number } = {},
): Promise<CommissionReleaseSummary> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 500;

  /*
   * Through `resilientRead`, like every other read in the server layer: it
   * carries the query deadline and the bounded connection retry (CLAUDE.md
   * §16.8). A scheduled job on a serverless platform is exactly where an
   * unbounded read is most expensive — it holds the invocation open until the
   * platform's own ceiling rather than failing and being retried tonight.
   *
   * Only the read. Nothing that *pays* anybody is retried: `releaseCommission`
   * below goes through `mutate()`, and a write that failed after its
   * statements reached the server may have committed.
   */
  const due = await resilientRead(() =>
    getDb()
    .select({
      id: t.commissionEntries.id,
      amountUsdt: t.commissionEntries.amountUsdt,
    })
    .from(t.commissionEntries)
    .where(
      and(
        eq(t.commissionEntries.status, "pending"),
        isNotNull(t.commissionEntries.releaseAt),
        lte(t.commissionEntries.releaseAt, now),
      ),
    )
    // Oldest first: if a pass is bounded and there is a backlog, the entries
    // that have waited longest are the ones that get paid tonight.
    .orderBy(asc(t.commissionEntries.releaseAt))
    .limit(limit),
  );

  const summary: CommissionReleaseSummary = {
    due: due.length,
    released: 0,
    releasedAmountUsdt: ZERO,
    skipped: [],
  };

  for (const entry of due) {
    try {
      const { amount } = await releaseCommission(
        {
          commissionEntryId: entry.id,
          note: "Released automatically on the scheduled date.",
        },
        SYSTEM_ACTOR,
      );
      summary.released += 1;
      // Exact addition — `add` from `@/db/money`, never `+` on money.
      summary.releasedAmountUsdt = add(summary.releasedAmountUsdt, amount);
    } catch (error) {
      summary.skipped.push({
        commissionEntryId: entry.id,
        reason: error instanceof Error ? error.message : "Unknown failure.",
      });
    }
  }

  return summary;
}
