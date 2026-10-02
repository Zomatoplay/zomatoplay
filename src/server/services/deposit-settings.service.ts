import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { getDb, isDatabaseConfigured, type Database, type Tx } from "@/db";
import * as t from "@/db/schema";
import type { AdminDepositConfiguration } from "@/types/admin";

import { resilientRead } from "../database";
import { addressesEqual, isTronAddress } from "../tron/address";
import {
  getTronConfig,
  isTronConfigured,
  TRON_NETWORK_LABELS,
  type TronConfig,
  type TronNetwork,
} from "../tron/config";
import { mutate, newId, withReason, type Actor } from "../write";

/**
 * The ONE address Zomato Play receives USDT (TRC-20) at.
 *
 * Replaces the per-user deposit-address pool. Two sources, one precedence:
 *
 *   1. `deposit_settings` — saved by an operator holding `manage` over
 *      `deposits`, audited with the old and new value.
 *   2. `TRON_PLATFORM_DEPOSIT_ADDRESS` — the deployment's bootstrap value, used
 *      until an operator saves one. This is why introducing the table changed
 *      nothing about where money is sent: the address customers see is the
 *      same one they saw before, until somebody deliberately changes it.
 *
 * The browser never supplies or chooses the address. The deposit screen gets it
 * from here, server-side, and a deposit request copies it onto its own row at
 * creation so a later change cannot redirect a request already quoted.
 */

export class DepositSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DepositSettingsError";
  }
}

export interface ActiveDepositAddress {
  address: string;
  network: TronNetwork;
  source: "configured" | "environment";
  updatedAt: Date | null;
  updatedByName: string | null;
}

const SETTINGS_KEY = { chain: "tron" as const, asset: "usdt" as const };

/** Reads the saved row inside any handle — a transaction or the pool. */
export async function readActiveDepositAddress(
  db: Database | Tx,
  config: TronConfig,
): Promise<ActiveDepositAddress | null> {
  const [row] = await db
    .select()
    .from(t.depositSettings)
    .where(
      and(
        eq(t.depositSettings.chain, SETTINGS_KEY.chain),
        eq(t.depositSettings.chainNetwork, config.network),
        eq(t.depositSettings.asset, SETTINGS_KEY.asset),
      ),
    )
    .limit(1);

  if (row) {
    return {
      address: row.receivingAddress,
      network: config.network,
      source: "configured",
      updatedAt: row.updatedAt,
      updatedByName: row.updatedByName,
    };
  }
  if (config.depositAddress) {
    return {
      address: config.depositAddress,
      network: config.network,
      source: "environment",
      updatedAt: null,
      updatedByName: null,
    };
  }
  return null;
}

/** The address a customer should send to right now, or null when none is set. */
export async function getActiveDepositAddress(): Promise<ActiveDepositAddress | null> {
  if (!isTronConfigured()) return null;
  const config = getTronConfig();
  if (!isDatabaseConfigured()) {
    return config.depositAddress
      ? {
          address: config.depositAddress,
          network: config.network,
          source: "environment",
          updatedAt: null,
          updatedByName: null,
        }
      : null;
  }
  return resilientRead(() => readActiveDepositAddress(getDb(), config));
}

/**
 * Changes the receiving address. `manage` over `deposits` is asserted by the
 * calling action; this validates and records.
 *
 * VALIDATED BEFORE ANYTHING IS WRITTEN
 * ------------------------------------
 * base58check, not a pattern: a mistyped address still looks like one — 34
 * characters starting with T — and saving it would send every customer's USDT
 * somewhere nobody controls. The token contract itself is refused too; it is a
 * valid address and a catastrophic destination.
 *
 * The audit entry carries the old and new address in the same transaction as
 * the change. Open deposit requests keep the address they were quoted
 * (`deposit_requests.receiving_address`), and the scanner keeps watching every
 * address that was ever active (`listWatchedAddresses`), so a late transfer to
 * the old one is still found.
 */
export async function setDepositAddress(
  request: { address: string; note?: string },
  actor: Actor,
): Promise<{ changed: boolean; address: string }> {
  if (!isTronConfigured()) {
    throw new DepositSettingsError(
      "TRON is not configured on this deployment (TRON_USDT_CONTRACT is unset).",
    );
  }
  const config = getTronConfig();
  const address = request.address.trim();

  if (!isTronAddress(address)) {
    throw new DepositSettingsError(
      "That is not a valid TRON address — the checksum does not match. Copy it again from your wallet.",
    );
  }
  if (addressesEqual(address, config.usdtContract)) {
    throw new DepositSettingsError(
      "That is the USDT token contract, not a wallet address. Funds sent there are lost.",
    );
  }

  return mutate(actor, async ({ tx, now, audit }) => {
    const current = await readActiveDepositAddress(tx, config);
    if (current?.source === "configured" && current.address === address) {
      return { changed: false, address };
    }

    await tx
      .insert(t.depositSettings)
      .values({
        id: newId("dcfg", now),
        chain: SETTINGS_KEY.chain,
        chainNetwork: config.network,
        asset: SETTINGS_KEY.asset,
        receivingAddress: address,
        updatedAt: now,
        updatedById: actor.id,
        updatedByName: actor.name,
      })
      .onConflictDoUpdate({
        target: [t.depositSettings.chain, t.depositSettings.chainNetwork, t.depositSettings.asset],
        set: {
          receivingAddress: address,
          updatedAt: now,
          updatedById: actor.id,
          updatedByName: actor.name,
        },
      });

    audit({
      action: "deposit_address_configured",
      target: { type: "settings", id: `deposit-address:${config.network}`, label: address },
      details: withReason(
        `Deposit address on TRON ${TRON_NETWORK_LABELS[config.network]} changed from ` +
          `${current ? `${current.address} (${current.source})` : "none"} to ${address}.`,
        request.note,
      ),
    });

    return { changed: true, address };
  });
}

/** The CRM's view: the active address, where it came from, and its history. */
export async function getDepositConfigurationForAdmin(): Promise<AdminDepositConfiguration> {
  const configured = isTronConfigured();
  const config = configured ? getTronConfig() : null;
  const base: AdminDepositConfiguration = {
    network: config?.network ?? "not configured",
    networkLabel: config ? `TRON ${TRON_NETWORK_LABELS[config.network]}` : "Not configured",
    asset: "USDT",
    standard: "TRC-20",
    address: null,
    source: "none",
    updatedAt: null,
    updatedBy: null,
    history: [],
  };
  if (!config) return base;

  if (!isDatabaseConfigured()) {
    return config.depositAddress
      ? { ...base, address: config.depositAddress, source: "environment" }
      : base;
  }

  return resilientRead(async () => {
    const db = getDb();
    const [active, history] = await Promise.all([
      readActiveDepositAddress(db, config),
      db
        .select({
          id: t.auditLogs.id,
          at: t.auditLogs.createdAt,
          actor: t.auditLogs.actorName,
          details: t.auditLogs.details,
        })
        .from(t.auditLogs)
        .where(eq(t.auditLogs.action, "deposit_address_configured"))
        .orderBy(desc(t.auditLogs.createdAt))
        .limit(10),
    ]);

    return {
      ...base,
      address: active?.address ?? null,
      source: active?.source ?? "none",
      updatedAt: active?.updatedAt?.toISOString() ?? null,
      updatedBy: active?.updatedByName ?? null,
      history: history.map((row) => ({ ...row, at: row.at.toISOString() })),
    };
  });
}

/**
 * Every address the scanner must watch on this network.
 *
 * The active one, and every one that was ever relevant — because a transfer to
 * an address that has stopped being advertised is still somebody's money and
 * must still surface in the operator queue rather than vanish:
 *
 *  - the active address (saved, or the environment's);
 *  - the environment address, even after an operator saved a different one;
 *  - every address a deposit request was ever quoted;
 *  - every address the scanner has ever kept a cursor for — which is how a
 *    previously configured address stays watched after it is replaced;
 *  - every row of the retired per-user pool (`deposit_addresses`), whose
 *    addresses customers were shown before this change.
 *
 * No transfer to any of them is credited merely for arriving: only a match to
 * a deposit request credits automatically (`deposit-requests.service`).
 */
export async function listWatchedAddresses(
  db: Database,
  config: TronConfig,
): Promise<string[]> {
  const [active, requested, scanned, legacyPool] = await Promise.all([
    readActiveDepositAddress(db, config),
    db
      .selectDistinct({ address: t.depositRequests.receivingAddress })
      .from(t.depositRequests)
      .where(eq(t.depositRequests.chainNetwork, config.network)),
    db
      .selectDistinct({ address: t.chainScanState.address })
      .from(t.chainScanState)
      .where(and(eq(t.chainScanState.chain, "tron"), eq(t.chainScanState.network, config.network))),
    db
      .selectDistinct({ address: t.depositAddresses.address })
      .from(t.depositAddresses)
      .where(and(eq(t.depositAddresses.chain, "tron"), eq(t.depositAddresses.network, config.network))),
  ]);

  const all = [
    active?.address,
    config.depositAddress,
    ...requested.map((row) => row.address),
    ...scanned.map((row) => row.address),
    ...legacyPool.map((row) => row.address),
  ].filter((address): address is string => typeof address === "string" && isTronAddress(address));

  return Array.from(new Set(all));
}
