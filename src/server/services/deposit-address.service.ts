import "server-only";

import { asc, eq, sql } from "drizzle-orm";

import { getDb } from "@/db";
import * as t from "@/db/schema";

import {
  claimAvailableAddress,
  findAssignedAddress,
  lockAllocationFor,
  PoolExhaustedError,
  releaseDepositAddress as releaseDepositAddressRow,
  retireDepositAddress as retireDepositAddressRow,
  type PoolTarget,
} from "../repositories/deposit-address.repository";
import { sweepDepositAddresses } from "./deposit-address-sweep.service";
import { IDLE_RELEASE_MS } from "./deposit-address-policy";
import { releaseDecision } from "./deposit-address-sweep.service";
import { ensureDepositAddressPool } from "../tron/pool";
import { isTronAddress } from "../tron/address";
import { getTronConfig, isTronConfigured, type TronNetwork } from "../tron/config";
import { mutate, newId, withReason, type Actor } from "../write";
import { recordPipelineEvent } from "../observability";
import type { AdminDepositAddress } from "@/types/admin";

/**
 * Issuing deposit addresses.
 *
 * `getOrCreateDepositAddress` is the one function anything outside this module
 * should call. Everything it does is safe to call repeatedly and from
 * multiple requests at once:
 *
 * - The pool sync is `ON CONFLICT DO NOTHING` — never touches an address that
 *   already exists (see `@/server/tron/pool`).
 * - Same-user concurrency is closed by an advisory lock scoped to this
 *   transaction (see `lockAllocationFor`).
 * - Cross-user concurrency for the last few available addresses is closed by
 *   `FOR UPDATE SKIP LOCKED` (see `claimAvailableAddress`).
 *
 * RELEASE: WHAT THIS DOES AND DOES NOT DECIDE
 * -------------------------------------------
 * This module never releases an address *because of the caller*. No page
 * closing, no session ending and no browser timer reclaims anything — those
 * are not facts about whether a transfer is still coming.
 *
 * What it does do, on the one path where it is both safe and necessary, is ask
 * the **sweep** to run when the pool has nothing left to hand out. That is a
 * server-side decision made from `assigned_at` and the address's own deposit
 * history, identical to the one the scheduled pass makes, and it is what stops
 * a two-address pool being permanently exhausted by two people who opened the
 * deposit screen once. See `./deposit-address-sweep.service` for why releasing
 * cannot misattribute a late transfer.
 */

export type PublicDepositAddress = Readonly<{
  address: string;
  chain: "TRON";
  network: (typeof import("@/db/schema").chainNetworkEnum.enumValues)[number];
  asset: "USDT";
  status: "assigned";
}>;

export class DepositAddressServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositAddressServiceError";
  }
}

/**
 * Resolves the caller's deposit address for a network/asset, allocating one
 * from the pool on first use.
 *
 * `userId` is the only identity this takes, and it is never read from the
 * browser — see the server action that calls this. Everything downstream
 * (the lock, the lookup, the claim) is keyed on it.
 */
export async function getOrCreateDepositAddress(
  userId: string,
  network: TronNetwork,
  actor: Actor,
): Promise<PublicDepositAddress> {
  if (!isTronConfigured()) {
    throw new DepositAddressServiceError(
      "Deposits are not configured for this environment.",
    );
  }

  const config = getTronConfig();
  if (config.network !== network) {
    throw new DepositAddressServiceError(
      `This environment is configured for ${config.network}, not ${network}.`,
    );
  }

  const target: PoolTarget = { chain: "tron", network, asset: "usdt" };

  /*
   * THE FAST PATH: A PLAIN READ, FOR THE CASE THAT IS ALMOST ALWAYS TRUE.
   *
   * Every render of `/wallet/deposit` calls this, and a user only ever claims
   * an address once — so after the first visit, the answer is a single indexed
   * lookup. It used to cost four round trips anyway: the pool sync (an INSERT),
   * then `BEGIN`, the lookup, `COMMIT`. Measured 2026-09-13 at p50 **1,087 ms**
   * against a ~200 ms round trip, which is exactly four.
   *
   * Nothing about the claim's safety moves. This read decides one thing —
   * "does an assignment already exist" — and an assignment, once made, is
   * never changed except by an explicit operator release or retirement. So a
   * hit here is as authoritative as a hit inside the transaction; there is no
   * state it could be racing. A miss falls through to the unchanged path
   * below, where the advisory lock, the re-check under it and
   * `FOR UPDATE SKIP LOCKED` still do all the work.
   */
  const existingAssignment = await findAssignedAddress(getDb(), userId, target);
  if (existingAssignment) {
    return {
      address: existingAssignment.address,
      chain: "TRON",
      network,
      asset: "USDT",
      status: "assigned",
    };
  }

  // Outside the transaction: an insert-only sync against a unique index needs
  // no lock, and keeping it out of the write transaction means a pool that is
  // already up to date costs one no-op round trip, not one inside `mutate`.
  await ensureDepositAddressPool(getDb(), config);

  const claim = () =>
    mutate(actor, async ({ tx, now }) => {
      const existing = await findAssignedAddress(tx, userId, target);
      if (existing) return existing;

      await lockAllocationFor(tx, userId, target);

      // Re-check under the lock: another request for this same user may have
      // committed an assignment while this one waited for the lock above.
      const afterLock = await findAssignedAddress(tx, userId, target);
      if (afterLock) return afterLock;

      return claimAvailableAddress(tx, userId, target, now);
    });

  let row;
  let swept = false;
  try {
    row = await claim();
  } catch (error) {
    /*
     * THE POOL IS EMPTY — SO FREE WHAT IS FREEABLE AND TRY ONCE MORE.
     *
     * An address is only genuinely scarce if every one of them is being used.
     * More often the pool is full of assignments made minutes ago to people
     * who opened the deposit screen and never sent anything, and the sweep is
     * exactly the thing that turns those back into capacity.
     *
     * Doing it **here**, on exhaustion, is what makes the pool self-healing on
     * a deployment with no scheduler configured — which the Hobby plan's
     * one-cron-a-day limit makes a realistic state. The scheduled pass
     * (`/api/cron/release-deposit-addresses`) remains the primary mechanism;
     * this is the safety net at the exact moment the capacity is needed.
     *
     * One retry, not a loop: if a sweep that released nothing is followed by a
     * still-empty pool, the pool really is too small and the operator needs to
     * add addresses. Saying so is more useful than spinning.
     */
    if (!(error instanceof PoolExhaustedError)) throw error;

    const summary = await sweepDepositAddresses();
    if (summary.released === 0) {
      throw new DepositAddressServiceError(
        "Every deposit address is currently in use. This usually clears " +
          `within ${Math.round(IDLE_RELEASE_MS / 60_000)} minutes — please try ` +
          "again shortly.",
      );
    }
    swept = true;
    row = await claim();
  }

  /*
   * Recorded because a pool assignment is the start of a money path.
   *
   * "Which account was shown which address, and when" is the first question
   * asked when a deposit turns up unattributed, and the audit entry `mutate`
   * writes answers it for the decision — this answers it for the *request*,
   * including the case where the pool had to be swept first, which is the
   * signal that the pool is undersized. No address is logged: the address is
   * already on the audit entry and in the row, and a log line is not the place
   * to duplicate it.
   */
  recordPipelineEvent({
    pipeline: "deposit",
    operation: "deposit.address.assigned",
    status: "ok",
    message: "Issued a deposit address to an account",
    userId,
    subject: { type: "deposit_address", id: row.id },
    metadata: { network, sweptFirst: swept },
  });

  return {
    address: row.address,
    chain: "TRON",
    network,
    asset: "USDT",
    status: "assigned",
  };
}

/**
 * Retires an address: permanently out of rotation, still watched, not deleted.
 *
 * The operation to reach for when an address is being *replaced* — a new
 * receiving address, a rotated one, one that should simply never be handed to
 * anybody again. `releaseDepositAddress` below is the wrong tool for that:
 * it returns the address to `available`, and because the pool is claimed in
 * `createdAt` order, an older released address goes straight back to the next
 * caller. See the repository function for the full reasoning.
 *
 * Operator-only, and subject to the same unresolved-deposit refusal release
 * has — literally the same function, not a copy.
 */
export async function retireDepositAddress(
  request: { addressId: string; reason: string },
  actor: Actor,
): Promise<void> {
  await mutate(actor, async ({ tx, now, audit }) => {
    const retired = await retireDepositAddressRow(tx, request.addressId, now);
    audit({
      action: "deposit_address_retired",
      target: { type: "deposit", id: retired.id, label: retired.address },
      details:
        `Retired deposit address ${retired.address} from rotation. It stays ` +
        `watched and is never claimable again. Reason: ${request.reason}`,
    });
  });
}

/**
 * Releases an address back to the pool. Operator-only; see the guard in
 * `releaseDepositAddress` in the repository for what refuses it.
 */
export async function releaseDepositAddress(
  request: { addressId: string; reason: string },
  actor: Actor,
): Promise<{ address: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    /*
     * The same function the automatic sweep calls, with `operator` as the
     * reason rather than a second implementation of the rule. That is what
     * guarantees a manual release can never be more permissive than an
     * automatic one: the unresolved-deposit refusal, the quarantine stamp and
     * closing the assignment interval all happen in one place.
     */
    const released = await releaseDepositAddressRow(
      tx,
      request.addressId,
      now,
      "operator",
    );
    audit({
      action: "deposit_address_released",
      target: { type: "deposit", id: released.id, label: released.address },
      details:
        `Released deposit address ${released.address} back to the pool. ` +
        `It is withheld from any other account until the quarantine window ` +
        `passes, and a transfer that arrives meanwhile is attributed to ` +
        `whoever held the address when it was sent. Reason: ${request.reason}`,
    });
    // Returned so the action can say *which* address changed rather than
    // reporting a success the caller has to take on trust.
    return { address: released.address };
  });
}

/**
 * Adds an operator-provided address to the pool for the configured network.
 *
 * WHY THE NETWORK IS NOT A PARAMETER
 * -----------------------------------
 * It is whatever `TRON_NETWORK` says this deployment scans. An address added
 * for a network the scanner is not watching is an address that can receive
 * money nothing will ever detect — so rather than accepting a network and
 * validating it, this takes none: there is exactly one it could correctly be.
 *
 * WHY THE CHECKSUM IS VERIFIED BEFORE THE ROW EXISTS
 * ---------------------------------------------------
 * `isTronAddress` is base58check, not a shape test. A mistyped or truncated
 * address still looks like an address, and one in this table is handed to a
 * customer as somewhere to send real USDT. The same validation
 * `TRON_PLATFORM_DEPOSIT_ADDRESS` gets at startup, applied to the same kind of
 * value arriving by a different route.
 *
 * WHY A DUPLICATE IS NOT AN ERROR
 * --------------------------------
 * The address is already in the pool, which is the state the operator wanted.
 * Reporting it as a failure would invite a second attempt at something that is
 * already true — and `ON CONFLICT DO NOTHING` means an address that already
 * belongs to somebody keeps its assignment, exactly as the configuration sync
 * does (see `@/server/tron/pool`).
 */
export async function addDepositAddress(
  request: { address: string; note?: string },
  actor: Actor,
): Promise<{ created: boolean; address: string }> {
  if (!isTronConfigured()) {
    throw new DepositAddressServiceError(
      "Deposits are not configured for this environment.",
    );
  }

  const config = getTronConfig();
  const address = request.address.trim();

  if (!isTronAddress(address)) {
    throw new DepositAddressServiceError(
      "That is not a valid TRON address — the base58 checksum does not match. " +
        "Check it against the wallet that generated it.",
    );
  }

  return mutate(actor, async ({ tx, now, audit }) => {
    const inserted = await tx
      .insert(t.depositAddresses)
      .values({
        id: newId("dpa", now),
        chain: "tron",
        network: config.network,
        asset: "usdt",
        address,
        status: "available",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [
          t.depositAddresses.chain,
          t.depositAddresses.network,
          t.depositAddresses.address,
        ],
      })
      .returning({ id: t.depositAddresses.id });

    if (inserted.length === 0) return { created: false, address };

    audit({
      action: "deposit_address_added",
      target: { type: "deposit", id: inserted[0].id, label: address },
      details: withReason(
        `Added deposit address ${address} to the ${config.network} pool. ` +
          `It is watched by the scanner from its next pass and can be assigned ` +
          `to the next account that opens the deposit screen.`,
        request.note,
      ),
    });

    return { created: true, address };
  });
}

export async function listDepositAddressesForAdmin(): Promise<AdminDepositAddress[]> {
  const rows = await getDb()
    .select({
      id: t.depositAddresses.id,
      address: t.depositAddresses.address,
      chain: t.depositAddresses.chain,
      network: t.depositAddresses.network,
      asset: t.depositAddresses.asset,
      status: t.depositAddresses.status,
      assignedUserId: t.depositAddresses.userId,
      assignedUserName: t.users.fullName,
      assignedUserDisplayId: t.users.displayId,
      assignedAt: t.depositAddresses.assignedAt,
      releasedAt: t.depositAddresses.releasedAt,
      quarantineUntil: t.depositAddresses.quarantineUntil,
      createdAt: t.depositAddresses.createdAt,
      // Text, not `Date`: a raw `sql` fragment carries no column type for
      // Drizzle to map, so postgres.js hands it back as a string. Converted
      // explicitly below. See the same note in the sweep service.
      lastDepositAt: sql<string | null>`(
        select max(${t.deposits.updatedAt}) from ${t.deposits}
        where ${t.deposits.walletAddress} = ${t.depositAddresses.address}
      )`,
      lastUserName: sql<string | null>`(
        select ${t.users.fullName} from ${t.users}
        where ${t.users.id} = ${t.depositAddresses.lastUserId}
      )`,
      /*
       * Correlated subqueries rather than a join and a group-by: there are a
       * handful of pool addresses, and a `LEFT JOIN deposits … GROUP BY` would
       * have to group every one of this row's columns to produce the same
       * three numbers. One statement either way.
       */
      depositCount: sql<number>`(
        select count(*)::int from ${t.deposits}
        where ${t.deposits.walletAddress} = ${t.depositAddresses.address}
      )`,
      unresolvedDeposits: sql<number>`(
        select count(*)::int from ${t.deposits}
        where ${t.deposits.walletAddress} = ${t.depositAddresses.address}
          and ${t.deposits.status} in ('pending', 'confirming', 'confirmed')
      )`,
      totalCreditedUsdt: sql<number>`(
        select coalesce(sum(${t.deposits.amountUsdt}), 0)::float8 from ${t.deposits}
        where ${t.deposits.walletAddress} = ${t.depositAddresses.address}
          and ${t.deposits.status} = 'credited'
      )`,
    })
    .from(t.depositAddresses)
    .leftJoin(t.users, eq(t.users.id, t.depositAddresses.userId))
    .orderBy(asc(t.depositAddresses.createdAt));

  const now = new Date();

  return rows.map(({ lastDepositAt, ...row }) => {
    /*
     * TWO DIFFERENT QUESTIONS, AND CONFLATING THEM IS WHAT BROKE THE SCREEN.
     *
     * "May an operator release this?" is answered by one rule and one only:
     * are there unresolved deposits against the address. An operator's
     * authority is not subject to the idle clock — they have looked at the
     * address and decided, and refusing them because it was assigned four
     * minutes ago would be inventing a restriction the write path does not
     * have.
     *
     * "Would the sweep release this on its next pass?" is the fuller
     * `releaseDecision`, and it is shown only to explain why an address that
     * looks idle is still assigned. Without it, a working sweep and a broken
     * one look identical from this table.
     */
    const unresolved = row.unresolvedDeposits;
    const releasable = row.status === "assigned" && unresolved === 0;
    const releaseBlockedBy =
      row.status !== "assigned"
        ? `Only an assigned address can be released — this one is ${row.status}.`
        : unresolved > 0
          ? `${unresolved} deposit${unresolved === 1 ? " has" : "s have"} not been ` +
            `credited, failed or ignored yet. Resolve ${unresolved === 1 ? "it" : "them"} ` +
            `in the deposits queue first — releasing now would take the address ` +
            `away from the only account it can still be attributed to.`
          : null;

    const auto =
      row.status === "assigned"
        ? releaseDecision(
            {
              assignedAt: row.assignedAt,
              lastDepositAt: lastDepositAt ? new Date(lastDepositAt) : null,
              depositCount: row.depositCount,
              unresolvedDeposits: unresolved,
            },
            now,
          )
        : null;

    return {
      ...row,
      assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
      releasedAt: row.releasedAt ? row.releasedAt.toISOString() : null,
      quarantineUntil: row.quarantineUntil
        ? row.quarantineUntil.toISOString()
        : null,
      createdAt: row.createdAt.toISOString(),
      releasable,
      releaseBlockedBy,
      autoReleaseEligible: auto?.release === true,
      autoReleaseBlockedBy: auto && !auto.release ? auto.blockedBy : null,
    };
  });
}
