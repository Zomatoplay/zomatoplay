import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import * as t from "@/db/schema";
import type { Tx } from "@/db";

/**
 * The deposit-address pool's data access.
 *
 * Everything here runs inside the caller's transaction (`Tx`, not `Database`)
 * because allocation has to be atomic with the decision that preceded it —
 * "does this user already have one" and "claim one for them" must happen as a
 * single unit, or two concurrent requests for the same new user can each pass
 * the first check and each claim a different address.
 */

export type DepositAddressRow = typeof t.depositAddresses.$inferSelect;

export interface PoolTarget {
  chain: "tron";
  network: (typeof t.chainNetworkEnum.enumValues)[number];
  asset: (typeof t.depositAssetEnum.enumValues)[number];
}

/** The user's current active address for this chain/network/asset, if any. */
export async function findAssignedAddress(
  tx: Tx,
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

  const [unresolved] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(t.deposits)
    .where(
      and(
        eq(t.deposits.walletAddress, row.address),
        sql`${t.deposits.status} in ('pending', 'confirming', 'confirmed')`,
      ),
    );
  if ((unresolved?.count ?? 0) > 0) {
    throw new AddressReleaseError(
      "This address has unresolved deposit activity and cannot be released.",
    );
  }

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
