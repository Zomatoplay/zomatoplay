import { sql } from "drizzle-orm";
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
 * HOW AN ADDRESS COMES BACK, AND WHAT MAKES THAT SAFE
 * ---------------------------------------------------
 * This table used to say reassignment was never automatic, on the reasoning
 * that a transfer landing after the tab closed must still find its owner. The
 * reasoning was right; the conclusion was too strong, and it had a cost the
 * pool could not absorb — an account that opened the deposit screen once and
 * never paid held its address forever, so a small pool ran dry and the next
 * customer met `PoolExhaustedError`.
 *
 * Three mechanisms replace "never", and all three are needed together:
 *
 *  1. **`deposit_address_assignments` is the record of who held what, when.**
 *     Attribution no longer asks "who holds this address" — it asks "who held
 *     it at the moment of this transfer's block". A late transfer is therefore
 *     still that person's, whoever holds the address now. See
 *     `findOwnerOfAddressAt`.
 *
 *  2. **`quarantine_until` keeps a released address away from a *different*
 *     user** for a configured window. Inside it, a transfer lands in a gap
 *     where nobody held the address, and a gap resolves to the operator queue —
 *     never to somebody else's wallet.
 *
 *  3. **`last_user_id` lets the same person get their own address back**, which
 *     carries no attribution risk at all and is the common case: somebody
 *     returning to finish a deposit they started.
 *
 * Release itself is still refused while any deposit against the address is
 * unresolved. That rule has not moved, and it is enforced in one function
 * shared by the manual and automatic paths.
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
    /** When the current holder last gave it up — by hand, or by the sweep. */
    releasedAt: ts("released_at"),

    /**
     * Who held it immediately before it was released.
     *
     * Kept when `user_id` is nulled, for two reasons. It lets the same person
     * be handed their own address back rather than a stranger's (no
     * attribution risk, and the returning-customer case is the common one),
     * and it means a row still says who to ask when a late transfer turns up.
     */
    lastUserId: text("last_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    /**
     * Before this instant, only the previous holder may claim this address.
     *
     * The window in which a transfer from the previous holder is still
     * plausible. Handing the address to somebody else inside it is the one way
     * an automatic release could credit the wrong account, so the claim query
     * refuses to — see `claimAvailableAddress`. Null means no restriction,
     * which is the state of an address that has never been held.
     */
    quarantineUntil: ts("quarantine_until"),

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
    /*
     * The sweep's own query: "assigned rows for this pool, oldest assignment
     * first". Without it the release job seq-scans the pool on every pass,
     * which is nothing today and is not nothing once the pool is the size it
     * needs to be.
     */
    index("deposit_addresses_assigned_idx").on(
      table.status,
      table.assignedAt,
    ),
  ],
);

/**
 * Who held which address, and between when and when.
 *
 * THE TABLE THAT MAKES RELEASING AN ADDRESS SAFE
 * ----------------------------------------------
 * `deposit_addresses` holds one row per address and therefore remembers only
 * the *current* holder. That is enough while an assignment is permanent and
 * catastrophically not enough once it is not: a transfer sent by yesterday's
 * holder, arriving after the address changed hands, would be credited to
 * today's holder — one person's money in another person's wallet, with the
 * chain showing nothing wrong.
 *
 * So the assignment is recorded as an *interval* and attribution is a lookup
 * by time: the owner of a transfer is whoever held the recipient address at
 * the transfer's own block timestamp. A transfer that falls in a gap — the
 * address was in the pool, or quarantined, or nobody's — matches no interval
 * and goes to the operator queue, which is exactly where an unattributable
 * transfer belongs (CLAUDE.md §18.4).
 *
 * APPEND-ONLY IN SPIRIT
 * ---------------------
 * A row is written when an address is claimed and closed (`released_at`) when
 * it is given up. Nothing else ever updates one and nothing deletes one; it is
 * evidence, and a dispute about where a deposit went is answered from here.
 * The address and its chain/network/asset are **copied onto the row** rather
 * than joined, for the same reason `audit_logs` copies the actor's name: the
 * history has to keep reading correctly after the pool row changes.
 */
export const depositAddressAssignments = pgTable(
  "deposit_address_assignments",
  {
    id: text("id").primaryKey(),
    addressId: text("address_id")
      .notNull()
      .references(() => depositAddresses.id, { onDelete: "cascade" }),
    /** Copied, not joined — see the note above. */
    address: text("address").notNull(),
    chain: chainEnum("chain").notNull().default("tron"),
    network: chainNetworkEnum("network").notNull().default("shasta"),
    asset: depositAssetEnum("asset").notNull().default("usdt"),

    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    assignedAt: ts("assigned_at").notNull(),
    /** Null while this is the current assignment. */
    releasedAt: ts("released_at"),
    /** Why it ended: `idle_timeout`, `settled`, `operator`, `retired`. */
    releaseReason: text("release_reason"),

    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    /*
     * One open assignment per address, enforced by Postgres rather than by
     * remembering to close the old one. A partial unique index is the only
     * shape that expresses "at most one row where released_at is null" — a
     * plain unique on `address_id` would forbid the history this table exists
     * to keep.
     */
    uniqueIndex("deposit_address_assignments_open_key")
      .on(table.addressId)
      .where(sql`${table.releasedAt} is null`),
    /* The attribution lookup: address, then the interval containing an instant. */
    index("deposit_address_assignments_lookup_idx").on(
      table.address,
      table.assignedAt,
    ),
    index("deposit_address_assignments_user_idx").on(table.userId),
  ],
);
