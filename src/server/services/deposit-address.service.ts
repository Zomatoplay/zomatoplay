import "server-only";

import { getDb } from "@/db";

import {
  claimAvailableAddress,
  findAssignedAddress,
  lockAllocationFor,
  releaseDepositAddress as releaseDepositAddressRow,
  type PoolTarget,
} from "../repositories/deposit-address.repository";
import { ensureDepositAddressPool } from "../tron/pool";
import { getTronConfig, isTronConfigured, type TronNetwork } from "../tron/config";
import { mutate, type Actor } from "../write";

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
 * WHAT THIS NEVER DOES
 * ---------------------
 * It never releases an address. There is no code path here, or anywhere a
 * request can reach, that reclaims an address because a page closed or a
 * session ended — see the `deposit_addresses` schema doc comment. Release is
 * `releaseDepositAddress` below, an explicit administrative action with its
 * own guard against unresolved activity.
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

  // Outside the transaction: an insert-only sync against a unique index needs
  // no lock, and keeping it out of the write transaction means a pool that is
  // already up to date costs one no-op round trip, not one inside `mutate`.
  await ensureDepositAddressPool(getDb(), config);

  const row = await mutate(actor, async ({ tx, now }) => {
    const existing = await findAssignedAddress(tx, userId, target);
    if (existing) return existing;

    await lockAllocationFor(tx, userId, target);

    // Re-check under the lock: another request for this same user may have
    // committed an assignment while this one waited for the lock above.
    const afterLock = await findAssignedAddress(tx, userId, target);
    if (afterLock) return afterLock;

    return claimAvailableAddress(tx, userId, target, now);
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
 * Releases an address back to the pool. Operator-only; see the guard in
 * `releaseDepositAddress` in the repository for what refuses it.
 */
export async function releaseDepositAddress(
  request: { addressId: string; reason: string },
  actor: Actor,
): Promise<void> {
  await mutate(actor, async ({ tx, now, audit }) => {
    const released = await releaseDepositAddressRow(tx, request.addressId, now);
    audit({
      action: "deposit_address_released",
      target: { type: "deposit", id: released.id, label: released.address },
      details: `Released deposit address ${released.address} back to the pool. Reason: ${request.reason}`,
    });
  });
}
