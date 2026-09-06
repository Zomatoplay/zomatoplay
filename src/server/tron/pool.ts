import "server-only";

import { and, eq } from "drizzle-orm";

import { getDb, type Database } from "@/db";
import * as t from "@/db/schema";

import { newId } from "../write";
import type { TronConfig } from "./config";

/**
 * Keeping the deposit-address pool in sync with configuration.
 *
 * `TRON_DEPOSIT_POOL_ADDRESSES` is the source of truth for *which addresses
 * exist*; this table is the source of truth for *who each one belongs to*.
 * This module reconciles the two, one direction only: it inserts configured
 * addresses that are not yet rows, and it never touches a row that already
 * exists — an address once seen keeps its assignment, its history and its
 * status regardless of what configuration says afterwards. Removing an
 * address from the env var does not un-assign it; that is what
 * `releaseDepositAddress` is for, deliberately, as an operator decision.
 *
 * Idempotent and cheap (`ON CONFLICT DO NOTHING` against the unique index on
 * (chain, network, address)), so it is safe to call on every allocation
 * request and every scanner pass rather than needing its own migration step.
 */
export async function ensureDepositAddressPool(
  db: Database,
  config: TronConfig,
): Promise<void> {
  if (config.poolAddresses.length === 0) return;

  const now = new Date();
  await db
    .insert(t.depositAddresses)
    .values(
      config.poolAddresses.map((address) => ({
        id: newId("dpa", now),
        chain: "tron" as const,
        network: config.network,
        asset: "usdt" as const,
        address,
        status: "available" as const,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing({
      target: [
        t.depositAddresses.chain,
        t.depositAddresses.network,
        t.depositAddresses.address,
      ],
    });
}

/**
 * Every address the scanner should watch for this chain and network.
 *
 * Every row ever created, regardless of status. A `retired` address is still
 * watched — see the doc comment on `deposit_addresses` for why: a stray
 * transfer to an address that has left rotation is still money, and it must
 * still surface somewhere rather than vanish because nothing is looking at it
 * any more.
 */
export async function listWatchedAddresses(
  db: Database,
  config: TronConfig,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ address: t.depositAddresses.address })
    .from(t.depositAddresses)
    .where(
      and(
        eq(t.depositAddresses.chain, "tron"),
        eq(t.depositAddresses.network, config.network),
      ),
    );
  return rows.map((row) => row.address);
}

/** Convenience for callers that only have a live DB handle, not a config. */
export async function syncAndListWatchedAddresses(
  config: TronConfig,
): Promise<string[]> {
  const db = getDb();
  await ensureDepositAddressPool(db, config);
  return listWatchedAddresses(db, config);
}
