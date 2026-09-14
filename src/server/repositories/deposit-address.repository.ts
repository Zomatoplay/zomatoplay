import "server-only";

import { and, asc, desc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";

import * as t from "@/db/schema";
import type { Database, Tx } from "@/db";
import { newId } from "../write";
import {
  REASSIGN_QUARANTINE_MS,
  type ReleaseReason,
} from "../services/deposit-address-policy";

/**
 * The deposit-address pool's data access.
 *
 * Everything that *changes* anything runs inside the caller's transaction
 * (`Tx`, not `Database`) because allocation has to be atomic with the decision
 * that preceded it — "does this user already have one" and "claim one for
 * them" must happen as a single unit, or two concurrent requests for the same
 * new user can each pass the first check and each claim a different address.
 *
 * `findAssignedAddress` is the one exception, and it takes `Tx | Database`
 * rather than widening the rule. It is a pure read of a fact that, once true,
 * is only ever changed by an explicit operator release or retirement — so
 * asking it outside a transaction cannot race anything. The service uses that
 * to answer the overwhelmingly common "this user already has an address" case
 * in one round trip instead of four; see the fast path in
 * `getOrCreateDepositAddress`. It is still called *again* inside the
 * transaction, under the advisory lock, on the path that actually claims.
 */

export type DepositAddressRow = typeof t.depositAddresses.$inferSelect;

export interface PoolTarget {
  chain: "tron";
  network: (typeof t.chainNetworkEnum.enumValues)[number];
  asset: (typeof t.depositAssetEnum.enumValues)[number];
}

/**
 * The user's current active address for this chain/network/asset, if any.
 *
 * Accepts a plain `Database` as well as a `Tx` — see the note at the top of
 * this file for why that is safe for this read and this read only.
 */
export async function findAssignedAddress(
  tx: Tx | Database,
  userId: string,
  target: PoolTarget,
): Promise<DepositAddressRow | null> {
  const [row] = await tx
    .select()
    .from(t.depositAddresses)
    .where(
      and(
        eq(t.depositAddresses.userId, userId),
        eq(t.depositAddresses.chain, target.chain),
        eq(t.depositAddresses.network, target.network),
        eq(t.depositAddresses.asset, target.asset),
        eq(t.depositAddresses.status, "assigned"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export class PoolExhaustedError extends Error {
  constructor(target: PoolTarget) {
    super(
      `No available deposit address for ${target.chain}/${target.network}/${target.asset}. ` +
        `The pool is fully assigned — add more addresses to TRON_DEPOSIT_POOL_ADDRESSES.`,
    );
    this.name = "PoolExhaustedError";
  }
}

/**
 * Claims one available address from the pool and assigns it.
 *
 * `FOR UPDATE SKIP LOCKED` is the standard "take a ticket" pattern: two
 * transactions racing this at once each lock a different available row rather
 * than blocking on each other or both claiming the same one. Ordered by
 * `createdAt` so addresses are handed out in a stable, auditable order rather
 * than whichever row Postgres happens to return first.
 *
 * Callers must serialise same-user concurrency themselves (an advisory lock —
 * see `getOrCreateDepositAddress`) before calling this: `SKIP LOCKED` prevents
 * two *different* claims from colliding, not a user racing themselves into two
 * addresses.
 */
export async function claimAvailableAddress(
  tx: Tx,
  userId: string,
  target: PoolTarget,
  now: Date,
): Promise<DepositAddressRow> {
  /*
   * QUARANTINE: A RELEASED ADDRESS IS NOT IMMEDIATELY ANYBODY ELSE'S.
   *
   * `quarantine_until` is stamped when an address is released. Until it
   * passes, only the account that just held it may take it back — which is
   * risk-free, because a late transfer from that same person is still theirs —
   * while anybody else is passed over. A transfer arriving in that gap matches
   * no assignment interval and goes to the operator queue rather than into a
   * stranger's wallet, which is the whole safety argument for releasing
   * automatically at all. See `@/server/services/deposit-address-policy`.
   *
   * Ordered so a row this user previously held is preferred over a stranger's:
   * `last_user_id = userId` first, then oldest-created, which keeps the stable
   * auditable ordering the pool always had for everything else.
   */
  const claimable = and(
    eq(t.depositAddresses.chain, target.chain),
    eq(t.depositAddresses.network, target.network),
    eq(t.depositAddresses.asset, target.asset),
    eq(t.depositAddresses.status, "available"),
    or(
      isNull(t.depositAddresses.quarantineUntil),
      lte(t.depositAddresses.quarantineUntil, now),
      eq(t.depositAddresses.lastUserId, userId),
    ),
  );

  const [candidate] = await tx
    .select({ id: t.depositAddresses.id })
    .from(t.depositAddresses)
    .where(claimable)
    .orderBy(
      /*
       * This user's own previous address first, then oldest-created.
       *
       * `IS NOT DISTINCT FROM` rather than `=`, and that is not pedantry:
       * `last_user_id = $1` is **NULL** for a row nobody has ever held, and
       * Postgres sorts NULLs *first* under `DESC` by default — so a plain `=`
       * would order never-held rows above rows that genuinely belong to this
       * user, and the preference would be silently inverted for exactly the
       * case it exists for. `IS NOT DISTINCT FROM` returns true or false and
       * never null, so `DESC` means what it reads as.
       */
      desc(sql`${t.depositAddresses.lastUserId} is not distinct from ${userId}`),
      asc(t.depositAddresses.createdAt),
    )
    .limit(1)
    .for("update", { skipLocked: true });

  if (!candidate) throw new PoolExhaustedError(target);

  const [claimed] = await tx
    .update(t.depositAddresses)
    .set({
      userId,
      status: "assigned",
      assignedAt: now,
      // Cleared on claim: the row is held again, so there is nothing to
      // withhold it from and a stale value would confuse the next release.
      quarantineUntil: null,
      lastUserId: userId,
      updatedAt: now,
    })
    // Re-asserted so a row that changed status between the two statements
    // (it cannot, under the lock just taken, but the guard costs nothing and
    // matches the rest of the codebase's belt-and-braces style) is refused
    // rather than silently claimed twice.
    .where(and(eq(t.depositAddresses.id, candidate.id), eq(t.depositAddresses.status, "available")))
    .returning();

  if (!claimed) throw new PoolExhaustedError(target);

  /*
   * The interval opens here, in the same transaction as the claim.
   *
   * Attribution reads this table rather than `deposit_addresses.user_id`, so a
   * claim without its history row would be an assignment no deposit could ever
   * be matched to. One transaction is what makes that impossible.
   */
  await tx.insert(t.depositAddressAssignments).values({
    id: newId("dpx", now),
    addressId: claimed.id,
    address: claimed.address,
    chain: claimed.chain,
    network: claimed.network,
    asset: claimed.asset,
    userId,
    assignedAt: now,
    createdAt: now,
  });

  return claimed;
}

/**
 * Serialises concurrent first-time allocation requests from the same user.
 *
 * `findAssignedAddress` is a plain read, so two requests arriving at once for
 * a user with no address yet would both see "none" and both claim a pool
 * slot — the one race `SKIP LOCKED` does not prevent, because it is two
 * transactions correctly agreeing there is no existing row, not two
 * transactions fighting over one. A transaction-scoped advisory lock, keyed to
 * this user and target, closes it: the second request blocks until the first
 * commits its assignment, then re-reads and finds it.
 */
export async function lockAllocationFor(
  tx: Tx,
  userId: string,
  target: PoolTarget,
): Promise<void> {
  const key = `${userId}:${target.chain}:${target.network}:${target.asset}`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
}

/**
 * Who held this address at a given instant.
 *
 * ATTRIBUTION IS BY TIME, NOT BY CURRENT HOLDER — AND THAT IS THE POINT.
 * ---------------------------------------------------------------------
 * This used to read `deposit_addresses` and return whoever holds the address
 * *now*. That is correct exactly as long as an assignment is permanent, and
 * catastrophically wrong the moment one is not: a transfer sent by yesterday's
 * holder, arriving after the address changed hands, would be credited to
 * today's holder. One customer's deposit in another customer's wallet, with
 * nothing on the chain to indicate anything went wrong.
 *
 * So the question asked is "who held this address at `at`", answered from
 * `deposit_address_assignments` — an append-only record of intervals. `at` is
 * the transfer's own **block timestamp**, which is a fact about the chain and
 * not about when the scanner happened to run, so a pass that runs late cannot
 * change who a deposit belongs to.
 *
 * Three outcomes, and the third is the one worth preserving:
 *
 *   an interval contains `at`   →  that user
 *   no interval contains `at`   →  **null** — the address was in the pool,
 *                                  quarantined, or nobody's at that moment, so
 *                                  the deposit is unattributed and goes to the
 *                                  operator queue (CLAUDE.md §18.4)
 *   the address is not ours     →  null, likewise
 *
 * Returning null is never a loss: an unattributed deposit is visible, credits
 * nobody, and an operator assigns it by hand. Guessing would be the loss.
 */
export async function findOwnerOfAddressAt(
  tx: Tx,
  target: PoolTarget & { address: string },
  at: Date,
): Promise<{ addressId: string; userId: string; assignmentId: string } | null> {
  const [row] = await tx
    .select({
      id: t.depositAddressAssignments.id,
      addressId: t.depositAddressAssignments.addressId,
      userId: t.depositAddressAssignments.userId,
    })
    .from(t.depositAddressAssignments)
    .where(
      and(
        eq(t.depositAddressAssignments.chain, target.chain),
        eq(t.depositAddressAssignments.network, target.network),
        eq(t.depositAddressAssignments.asset, target.asset),
        eq(t.depositAddressAssignments.address, target.address),
        lte(t.depositAddressAssignments.assignedAt, at),
        // Open, or closed after the transfer landed. `released_at` is exact:
        // an address released at 10:00 does not own a transfer from 10:01.
        or(
          isNull(t.depositAddressAssignments.releasedAt),
          gt(t.depositAddressAssignments.releasedAt, at),
        ),
      ),
    )
    // Most recent interval first. They cannot overlap — one open row per
    // address is enforced by a partial unique index — but ordering makes the
    // answer deterministic rather than dependent on physical row order, which
    // is a lesson this codebase has already paid for once (CLAUDE.md §16.7).
    .orderBy(desc(t.depositAddressAssignments.assignedAt))
    .limit(1);

  if (!row) return null;
  return { addressId: row.addressId, userId: row.userId, assignmentId: row.id };
}

export class AddressReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AddressReleaseError";
  }
}

/**
 * Releases an address back to the pool — an explicit operator decision, never
 * automatic (see the `deposit_addresses` doc comment on why).
 *
 * Refuses when any deposit against this address has not reached a terminal
 * state (`credited`, `failed` or `ignored`): a `pending`, `confirming` or
 * `confirmed`-but-unassigned row means blockchain activity that has not been
 * resolved yet, and releasing the address while that is outstanding is
 * exactly the "unresolved activity gets reassigned" failure this table exists
 * to prevent.
 */
export async function releaseDepositAddress(
  tx: Tx,
  addressId: string,
  now: Date,
  reason: ReleaseReason = "operator",
): Promise<DepositAddressRow> {
  const [row] = await tx
    .select()
    .from(t.depositAddresses)
    .where(eq(t.depositAddresses.id, addressId))
    .limit(1)
    .for("update");
  if (!row) throw new AddressReleaseError(`No deposit address ${addressId}.`);
  if (row.status !== "assigned") {
    throw new AddressReleaseError(
      `Only an assigned address can be released — this one is ${row.status}.`,
    );
  }

  await assertNoUnresolvedDeposits(tx, row.address, "released");

  const [updated] = await tx
    .update(t.depositAddresses)
    .set({
      userId: null,
      status: "available",
      releasedAt: now,
      /*
       * The window in which only the previous holder may take it back.
       *
       * Stamped at release rather than computed at claim time so the promise
       * made to this particular holder is a stored fact. Changing the policy
       * afterwards then applies to future releases and cannot retroactively
       * shorten one somebody is already relying on.
       */
      quarantineUntil: new Date(now.getTime() + REASSIGN_QUARANTINE_MS),
      // `user_id` is cleared; who held it is not lost.
      lastUserId: row.userId ?? row.lastUserId,
      updatedAt: now,
    })
    .where(and(eq(t.depositAddresses.id, addressId), eq(t.depositAddresses.status, "assigned")))
    .returning();
  if (!updated) throw new AddressReleaseError("That address changed while releasing it.");

  await closeOpenAssignment(tx, addressId, now, reason);
  return updated;
}

/**
 * Closes the open interval for an address.
 *
 * `released_at` is what stops a later transfer being attributed to the holder
 * who has just let the address go — see `findOwnerOfAddressAt`. It runs in the
 * same transaction as the status change, so there is no instant at which the
 * pool row says "available" and the history still says somebody owns it.
 *
 * Tolerant of there being no open row: addresses assigned before this table
 * existed were backfilled, but a row created by some future path that forgets
 * to open an interval should still be releasable rather than wedged.
 */
async function closeOpenAssignment(
  tx: Tx,
  addressId: string,
  now: Date,
  reason: ReleaseReason,
): Promise<void> {
  await tx
    .update(t.depositAddressAssignments)
    .set({ releasedAt: now, releaseReason: reason })
    .where(
      and(
        eq(t.depositAddressAssignments.addressId, addressId),
        isNull(t.depositAddressAssignments.releasedAt),
      ),
    );
}

/**
 * Why an address cannot be released, in a form a screen can render.
 *
 * `assertNoUnresolvedDeposits` throws, which is right for a write path and
 * useless for "should this button be enabled and what should the tooltip
 * say". This is the same rule asked as a question, so the UI, the sweep and
 * the operator action all agree by construction rather than by three
 * implementations happening to match.
 */
export interface ReleaseEligibility {
  releasable: boolean;
  /** `idle_timeout` / `settled` when releasable; otherwise undefined. */
  reason?: ReleaseReason;
  /** Why not, in plain words. Shown to the operator verbatim. */
  blockedBy?: string;
  unresolvedDeposits: number;
}

/**
 * The safety check both un-assignment paths share.
 *
 * Extracted rather than copied: "an address with deposit activity still in
 * flight must not leave its owner" is one rule, and a second copy of it is a
 * second thing to forget to update. `pending`, `confirming` and an unassigned
 * `confirmed` all mean blockchain activity nobody has resolved yet.
 */
async function assertNoUnresolvedDeposits(
  tx: Tx,
  address: string,
  verb: "released" | "retired",
): Promise<void> {
  const unresolved = await countUnresolvedDeposits(tx, address);
  if (unresolved > 0) {
    throw new AddressReleaseError(
      `This address has ${unresolved} unresolved deposit${unresolved === 1 ? "" : "s"} ` +
        `and cannot be ${verb}. Resolve them in the deposits queue — credit, ` +
        `fail or ignore each one — and try again.`,
    );
  }
}

/**
 * Deposits against an address that nobody has finished dealing with.
 *
 * `pending` and `confirming` are still arriving. A `confirmed` row with no
 * `user_id` is money that landed and has not been attributed to anybody — the
 * legacy shared-address case (CLAUDE.md §18.4) — and releasing the address out
 * from under it would destroy the only context an operator has for deciding
 * whose it was.
 *
 * A `confirmed` row that *is* attributed is not a blocker: it belongs to a
 * known account and the settlement path will credit it.
 */
export async function countUnresolvedDeposits(
  tx: Tx | Database,
  address: string,
): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(t.deposits)
    .where(
      and(
        eq(t.deposits.walletAddress, address),
        sql`${t.deposits.status} in ('pending', 'confirming', 'confirmed')`,
      ),
    );
  return row?.count ?? 0;
}

/**
 * Retires an address: out of rotation, permanently, without deleting it.
 *
 * WHY THIS IS NOT `releaseDepositAddress`
 * ---------------------------------------
 * Release returns an address to `available`, which is right when an address
 * should go back into circulation. It is wrong when the address is being
 * *replaced* — because `claimAvailableAddress` orders the pool by `createdAt`,
 * an older released address is handed straight back to the next caller, which
 * is exactly the person who was supposed to stop using it. Retiring is the
 * operation that has no such trap: `retired` is not `available`, so nothing
 * claims it, ever.
 *
 * WHAT IS DELIBERATELY KEPT
 * -------------------------
 * The row, the address, and `user_id`. Retiring is not a deletion and not an
 * erasure of who held the address — that is history an operator may need when
 * a late transfer to it turns up. What removes it from every live path is the
 * status alone, and that is enough because all three of them filter on it:
 * `claimAvailableAddress` wants `available`, `findAssignedAddress` and
 * `findOwnerOfAddressAt` resolves by interval. So a retired address is never handed
 * out, never shown as somebody's current address, and never auto-credited —
 * while `listWatchedAddresses` returns rows of every status, so the scanner
 * keeps watching it and a stray transfer still surfaces in the operator queue
 * instead of vanishing. That is the behaviour the `deposit_addresses` doc
 * comment describes; this is the function that finally produces it.
 *
 * Accepts `assigned` and `available` alike — an address can need withdrawing
 * from rotation whether or not somebody currently holds it — and refuses one
 * that is already `retired`, because a second retirement would rewrite
 * `released_at` and lose when it actually left.
 */
export async function retireDepositAddress(
  tx: Tx,
  addressId: string,
  now: Date,
): Promise<DepositAddressRow> {
  const [row] = await tx
    .select()
    .from(t.depositAddresses)
    .where(eq(t.depositAddresses.id, addressId))
    .limit(1)
    .for("update");
  if (!row) throw new AddressReleaseError(`No deposit address ${addressId}.`);
  if (row.status === "retired") {
    throw new AddressReleaseError("That address is already retired.");
  }

  // The same rule release enforces, on the same code path.
  await assertNoUnresolvedDeposits(tx, row.address, "retired");

  const [updated] = await tx
    .update(t.depositAddresses)
    .set({
      status: "retired",
      // When it left rotation. `assigned_at` and `user_id` are untouched, so
      // the row still says who held it and from when.
      releasedAt: now,
      updatedAt: now,
    })
    // The status observed under the lock, re-asserted — so two operators
    // retiring at once produce one retirement and one clear refusal.
    .where(
      and(
        eq(t.depositAddresses.id, addressId),
        eq(t.depositAddresses.status, row.status),
      ),
    )
    .returning();
  if (!updated) throw new AddressReleaseError("That address changed while retiring it.");

  /*
   * The interval is closed even though `user_id` is kept on the pool row.
   *
   * A retired address is never handed to anybody else, so leaving the interval
   * open would not misattribute anything — but it would mean the history says
   * somebody still holds an address that has left rotation, and "open" is the
   * thing the partial unique index and the sweep both key on. Closed, with the
   * reason recorded, is the honest state.
   */
  await closeOpenAssignment(tx, addressId, now, "retired");
  return updated;
}

/** True while at least one address is unassigned for this pool target. */
export async function hasAvailableAddress(tx: Tx, target: PoolTarget): Promise<boolean> {
  const [row] = await tx
    .select({ id: t.depositAddresses.id })
    .from(t.depositAddresses)
    .where(
      and(
        eq(t.depositAddresses.chain, target.chain),
        eq(t.depositAddresses.network, target.network),
        eq(t.depositAddresses.asset, target.asset),
        eq(t.depositAddresses.status, "available"),
        isNull(t.depositAddresses.userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
