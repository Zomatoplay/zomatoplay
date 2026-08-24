import { bigint, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { ts } from "./columns";
import { chainEnum, chainNetworkEnum } from "./enums";

/**
 * Where the scanner got to.
 *
 * One row per (chain, network, address) being watched. It exists so a poll can
 * resume rather than re-reading the whole history of an address every time:
 * TronGrid pages and rate-limits, and an address with a few thousand transfers
 * would otherwise cost the same requests on every tick forever.
 *
 * The cursor is deliberately *not* the safety mechanism. Losing it, resetting
 * it or replaying from zero is harmless, because the unique index on
 * `deposits(chain, tx_hash)` is what prevents a double credit. This is an
 * efficiency record; correctness lives in the constraint.
 */
export const chainScanState = pgTable(
  "chain_scan_state",
  {
    id: text("id").primaryKey(),
    chain: chainEnum("chain").notNull().default("tron"),
    network: chainNetworkEnum("network").notNull().default("shasta"),
    /** The watched address — the platform deposit address today. */
    address: text("address").notNull(),

    /** Highest block seen. Informational; the timestamp below is the cursor. */
    lastBlockNumber: bigint("last_block_number", { mode: "bigint" }),
    /**
     * The scanner asks TronGrid for transfers at or after this instant.
     * Stored a little behind the true high-water mark so a re-org or a
     * late-indexed transfer is picked up rather than skipped.
     */
    lastTimestamp: ts("last_timestamp"),

    lastScanAt: ts("last_scan_at"),
    lastSuccessAt: ts("last_success_at"),
    /**
     * The last failure, kept so a scanner that has been quietly failing for a
     * day is visible rather than merely absent from the logs.
     */
    lastError: text("last_error"),
    consecutiveFailures: bigint("consecutive_failures", { mode: "number" })
      .notNull()
      .default(0),

    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chain_scan_state_target_key").on(
      table.chain,
      table.network,
      table.address,
    ),
    index("chain_scan_state_address_idx").on(table.address),
  ],
);
