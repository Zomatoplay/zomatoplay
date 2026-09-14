import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import * as t from "@/db/schema";
import type { Database, Tx } from "@/db";

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
  const [candidate] = await tx
    .select({ id: t.depositAddresses.id })
    .from(t.depositAddresses)
    .where(
      and(
        eq(t.depositAddresses.chain, target.chain),
        eq(t.depositAddresses.network, target.network),
        eq(t.depositAddresses.asset, target.asset),
        eq(t.depositAddresses.status, "available"),
      ),
    )
    .orderBy(asc(t.depositAddresses.createdAt))
    .limit(1)
    .for("update", { skipLocked: true });

  if (!candidate) throw new PoolExhaustedError(target);

  const [claimed] = await tx
    .update(t.depositAddresses)
    .set({ userId, status: "assigned", assignedAt: now, updatedAt: now })
    // Re-asserted so a row that changed status between the two statements
    // (it cannot, under the lock just taken, but the guard costs nothing and
    // matches the rest of the codebase's belt-and-braces style) is refused
    // rather than silently claimed twice.
    .where(and(eq(t.depositAddresses.id, candidate.id), eq(t.depositAddresses.status, "available")))
    .returning();

  if (!claimed) throw new PoolExhaustedError(target);
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

/** Resolves a received transfer's recipient address to its owning user. */
export async function findOwnerOfAddress(
  tx: Tx,
  target: PoolTarget & { address: string },
): Promise<{ addressId: string; userId: string } | null> {
  const [row] = await tx
    .select({ id: t.depositAddresses.id, userId: t.depositAddresses.userId })
    .from(t.depositAddresses)
    .where(
      and(
        eq(t.depositAddresses.chain, target.chain),
        eq(t.depositAddresses.network, target.network),
        eq(t.depositAddresses.asset, target.asset),
        eq(t.depositAddresses.address, target.address),
        eq(t.depositAddresses.status, "assigned"),
      ),
    )
    .limit(1);
  if (!row || !row.userId) return null;
  return { addressId: row.id, userId: row.userId };
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
): Promise<DepositAddressRow> {
  const [row] = await tx
    .select()
    .from(t.depositAddresses)
    .where(eq(t.depositAddresses.id, addressId))
    .limit(1)
    .for("update");
  if (!row) throw new AddressReleaseError(`No deposit address ${addressId}.`);
  if (row.status !== "assigned") {
    throw new AddressReleaseError("Only an assigned address can be released.");
  }

  await assertNoUnresolvedDeposits(tx, row.address, "released");

  const [updated] = await tx
    .update(t.depositAddresses)
    .set({
      userId: null,
      status: "available",
      releasedAt: now,
      updatedAt: now,
    })
    .where(and(eq(t.depositAddresses.id, addressId), eq(t.depositAddresses.status, "assigned")))
    .returning();
  if (!updated) throw new AddressReleaseError("That address changed while releasing it.");
  return updated;
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
  const [unresolved] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(t.deposits)
    .where(
      and(
        eq(t.deposits.walletAddress, address),
        sql`${t.deposits.status} in ('pending', 'confirming', 'confirmed')`,
      ),
    );
  if ((unresolved?.count ?? 0) > 0) {
    throw new AddressReleaseError(
      `This address has unresolved deposit activity and cannot be ${verb}.`,
    );
  }
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
 * `findOwnerOfAddress` want `assigned`. So a retired address is never handed
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
