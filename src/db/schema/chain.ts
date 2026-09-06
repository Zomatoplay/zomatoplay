import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { ts } from "./columns";
import {
  chainEnum,
  chainNetworkEnum,
  depositAddressStatusEnum,
  depositAssetEnum,
} from "./enums";
import { users } from "./users";

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

/**
 * The deposit-address pool: which blockchain address belongs to which user.
 *
 * WHY THIS TABLE EXISTS
 * ----------------------
 * A single shared receiving address cannot say who paid — see the long note on
 * `deposits` in `@/db/schema/ledger`. This table is the structural fix: one row
 * links one address to at most one user at a time, so the scanner resolves
 * `to_address → user_id` at detection time instead of an operator guessing
 * from nothing.
 *
 * WHY IT IS A POOL, NOT ONE ROW PER USER
 * ---------------------------------------
 * This phase manages a small, fixed set of addresses (configured via
 * `TRON_DEPOSIT_POOL_ADDRESSES`, sized by how many are listed there) and hands
 * them out on demand — `available → assigned` — rather than minting a fresh
 * address per signup. `derivation_index` is carried for when addresses are
 * generated from a BIP-44 account key instead of configured by hand: it is the
 * index used to derive that specific address, recorded so the mapping from
 * index to address is explicit rather than positional. See CLAUDE.md §18.8 for
 * why nothing in this codebase derives one today.
 *
 * WHY REASSIGNMENT IS NEVER AUTOMATIC
 * -------------------------------------
 * `released_at` is set by exactly one thing: a deliberate operator action, and
 * that action refuses an address with any deposit still in flight. Nothing
 * here ever reclaims an address because a page closed, a session expired, or
 * time passed — a transfer that lands after the tab is gone must still find
 * its owner.
 *
 * `status = 'retired'` is not deleted and is not re-derivable as `available`:
 * once an address leaves rotation it is watched forever (see
 * `chain_scan_state`, keyed by address, not by pool status), because a stray
 * transfer to a since-retired address is still money and must still surface
 * somewhere, never silently disappear.
 */
export const depositAddresses = pgTable(
  "deposit_addresses",
  {
    id: text("id").primaryKey(),

    /** Null while the address sits unclaimed in the pool. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),

    chain: chainEnum("chain").notNull().default("tron"),
    network: chainNetworkEnum("network").notNull().default("shasta"),
    asset: depositAssetEnum("asset").notNull().default("usdt"),
    address: text("address").notNull(),

    /**
     * The BIP-44 address index this row was derived at, when it was derived
     * rather than configured directly. Nullable: every address in this pool
     * today is operator-provided, not derived — see the table doc comment.
     */
    derivationIndex: integer("derivation_index"),

    status: depositAddressStatusEnum("status").notNull().default("available"),
    assignedAt: ts("assigned_at"),
    /** Set only by an explicit administrative release — never automatically. */
    releasedAt: ts("released_at"),

    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    // One physical address is one row, on one chain and network, ever.
    uniqueIndex("deposit_addresses_chain_network_address_key").on(
      table.chain,
      table.network,
      table.address,
    ),
    index("deposit_addresses_user_idx").on(table.userId),
    index("deposit_addresses_status_idx").on(table.chain, table.network, table.status),
  ],
);
