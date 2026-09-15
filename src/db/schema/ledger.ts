import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { inr, rate, ts, usdt } from "./columns";
import {
  chainEnum,
  chainNetworkEnum,
  currencyEnum,
  depositNetworkEnum,
  depositStatusEnum,
  depositVerificationEnum,
  transactionStatusEnum,
  transactionTypeEnum,
  withdrawalStatusEnum,
} from "./enums";
import { users } from "./users";

/**
 * The account ledger: every movement the user sees in their history.
 *
 * Deposits and withdrawals also have their own tables below. That is not
 * duplication — those tables hold the *rail* record (chain confirmations,
 * payout references, operator decisions) which only the CRM cares about, while
 * this table holds the balance-affecting entry the user reads. A credited
 * deposit produces one row in each, linked by `reference`.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: transactionTypeEnum("type").notNull(),
    /** Positive credits the wallet, negative debits it. */
    amount: usdt("amount").notNull(),
    currency: currencyEnum("currency").notNull().default("USDT"),
    status: transactionStatusEnum("status").notNull(),
    occurredAt: ts("occurred_at").notNull(),
    description: text("description").notNull(),
    /** Chain reference for deposits, payout reference for withdrawals. */
    reference: text("reference"),
    network: depositNetworkEnum("network"),
    confirmationsCurrent: integer("confirmations_current"),
    confirmationsRequired: integer("confirmations_required"),
    /** INR actually paid out — withdrawals only. */
    inrAmount: inr("inr_amount"),
    feeUsdt: usdt("fee_usdt"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("transactions_user_idx").on(table.userId),
    index("transactions_occurred_idx").on(table.occurredAt),
    /*
     * "This account's ledger, newest first" — the hottest read in the product.
     *
     * Home, Wallet and the history screen all run
     * `where user_id = $1 order by occurred_at desc limit $2`. The two indexes
     * above cannot serve it together: Postgres uses `transactions_user_idx` to
     * find the account's rows and then **sorts every one of them** to take the
     * top N. That sort is invisible at 200 rows and is the whole cost at
     * 20,000 — it grows with an account's history on a query that runs on
     * every navigation.
     *
     * Ordered `desc` to match the query exactly, so the scan walks the index
     * backwards from the newest entry and stops at the limit. Added with the
     * limits, not before them: the limit is what turns this from "avoid a
     * sort" into "read N rows and stop".
     */
    index("transactions_user_recent_idx").on(
      table.userId,
      table.occurredAt.desc(),
    ),
    index("transactions_type_idx").on(table.type),
    index("transactions_status_idx").on(table.status),
  ],
);

/**
 * A deposit: one incoming on-chain transfer to a platform address.
 *
 * ATTRIBUTION — READ THIS BEFORE CHANGING `user_id`
 * ------------------------------------------------
 * `user_id` is **nullable**, and it is set two different ways, deliberately
 * kept separate — see the long note on `recordObservedDeposit` in
 * `@/server/services/deposits.service`:
 *
 * - **Automatically**, when the recipient address resolves through
 *   `deposit_addresses` (`@/db/schema/chain.ts`) to a user it is currently
 *   assigned to. The address *is* the identity there; nothing is guessed.
 * - **Never automatically otherwise.** A transfer to the legacy shared
 *   address, or to a pool address nobody currently holds, carries a sender and
 *   nothing else — no memo, no invoice id, no link to an account in this
 *   system, and two users paying from the same exchange withdrawal are
 *   indistinguishable on-chain. That deposit belongs to *nobody* until an
 *   operator says otherwise, in `/admin/deposits`, and the schema says so
 *   instead of guessing.
 *
 * Guessing would mean matching on `sender_address`, which is wrong in the ways
 * that matter: exchanges send from shared hot wallets, and a user can pay from
 * an address they have never told us about. Crediting the wrong account is not
 * a display bug, it is a loss.
 *
 * INTEGRATION POINT: the scanner in `@/server/tron` writes these rows. It sets
 * `user_id` only through the `deposit_addresses` resolution above — never by
 * inference from the transfer itself.
 */
export const deposits = pgTable(
  "deposits",
  {
    id: text("id").primaryKey(),

    /** Null until an operator attributes the transfer to an account. */
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    assignedAt: ts("assigned_at"),
    /** The operator who attributed it. */
    assignedBy: text("assigned_by"),

    amountUsdt: usdt("amount_usdt").notNull(),

    /* ------------------------------------------------------------- chain -- */

    chain: chainEnum("chain").notNull().default("tron"),
    chainNetwork: chainNetworkEnum("chain_network").notNull().default("shasta"),
    /** Retained from the pre-chain prototype; TRC-20 for everything TRON. */
    network: depositNetworkEnum("network").notNull(),
    /** The token contract the transfer was made in. */
    tokenContract: text("token_contract"),
    tokenSymbol: text("token_symbol"),
    /** Where the funds came from. Not an identity — see the note above. */
    senderAddress: text("sender_address"),
    /** The platform address that received them. */
    walletAddress: text("wallet_address").notNull(),
    /**
     * The chain's own identifier for this transfer, and the idempotency key:
     * a unique index on (chain, tx_hash) is what makes crediting the same
     * transfer twice impossible rather than merely unlikely.
     */
    txHash: text("tx_hash").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }),
    blockTimestamp: ts("block_timestamp"),

    /* ------------------------------------------------------------ status -- */

    status: depositStatusEnum("status").notNull().default("pending"),
    verification: depositVerificationEnum("verification")
      .notNull()
      .default("unverified"),
    /** Why verification failed, or why an operator ignored it. */
    failureReason: text("failure_reason"),

    /** Set when the scanner first saw it. */
    detectedAt: ts("detected_at"),
    /** Set when it became irreversible under the confirmation policy. */
    confirmedAt: ts("confirmed_at"),
    /** Set when the funds reached a user's wallet. */
    creditedAt: ts("credited_at"),

    /**
     * When the owning account was shown the "deposit confirmed" state and
     * dismissed it.
     *
     * WHY THIS IS A DATABASE COLUMN AND NOT `localStorage`
     * ----------------------------------------------------
     * "Has this person seen that their money arrived" is a fact about an
     * account, not about a browser. Kept client-side it would re-announce a
     * three-week-old deposit on every new device, every cleared cache and
     * every private window — which is the defect this closes: the deposit
     * screen listed recent deposits, so a historical one read as a fresh
     * arrival on every visit.
     *
     * Null means "credited and not yet acknowledged", which is exactly the
     * query the confirmation state runs. Only ever set — never cleared — so
     * the transition is one-way and re-announcing is structurally impossible.
     * It decides *presentation only*: nothing about whether money moved
     * depends on it, and the deposit stays in wallet history for ever either
     * way.
     */
    acknowledgedAt: ts("acknowledged_at"),

    confirmationsCurrent: integer("confirmations_current").notNull().default(0),
    confirmationsRequired: integer("confirmations_required").notNull(),

    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * The idempotency guarantee, enforced by the database rather than by the
     * scanner remembering to check. A retry, an overlapping poll window or two
     * scanners running at once all collide here instead of double-crediting.
     */
    uniqueIndex("deposits_chain_tx_hash_key").on(table.chain, table.txHash),
    index("deposits_user_idx").on(table.userId),
    index("deposits_status_idx").on(table.status),
    index("deposits_created_idx").on(table.createdAt),
    index("deposits_unassigned_idx").on(table.status, table.userId),
    index("deposits_sender_idx").on(table.senderAddress),
    /*
     * "What has arrived at this receiving address, and is any of it
     * unresolved?"
     *
     * Three call sites ask it and one of them gates a write:
     * `countUnresolvedDeposits` is the safety check that refuses to release an
     * address with deposit activity still in flight, and it runs inside the
     * release transaction; the sweep's candidate rollup asks it for every
     * assigned address on every pass; and the CRM's address list asks it three
     * times per row. `sender_address` was indexed and `wallet_address` — the
     * side this application actually scans and attributes on — was not, so all
     * three were sequential scans of `deposits`.
     */
    index("deposits_wallet_address_idx").on(table.walletAddress, table.status),
    /** "This account's credited deposits it has not acknowledged yet." */
    index("deposits_unacknowledged_idx").on(
      table.userId,
      table.status,
      table.acknowledgedAt,
    ),
  ],
);

/**
 * The payout rail record.
 *
 * `payoutRate` is stored on the row because it is quoted at request time and
 * must never be recomputed from today's rate — the user was shown a specific
 * INR figure, and that figure is what is owed. Every fee component is stored
 * separately for the same reason: the CRM shows the full arithmetic rather
 * than a net number the operator has to trust.
 *
 * INTEGRATION POINT: real INR payouts are not implemented. Status transitions
 * here are operator decisions, not rail events.
 */
export const withdrawals = pgTable(
  "withdrawals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amountUsdt: usdt("amount_usdt").notNull(),
    payoutRate: rate("payout_rate").notNull(),
    flatFeeUsdt: usdt("flat_fee_usdt").notNull().default(0),
    percentFeeUsdt: usdt("percent_fee_usdt").notNull().default(0),
    totalFeeUsdt: usdt("total_fee_usdt").notNull().default(0),
    /** INR payable after fees, at the quoted rate. */
    netInr: inr("net_inr").notNull(),
    destinationLabel: text("destination_label").notNull(),
    destinationBankName: text("destination_bank_name").notNull(),
    destinationAccountMasked: text("destination_account_masked").notNull(),
    destinationIfsc: text("destination_ifsc").notNull(),
    destinationHolderName: text("destination_holder_name").notNull(),
    requestedAt: ts("requested_at").notNull(),
    settledAt: ts("settled_at"),
    status: withdrawalStatusEnum("status").notNull().default("pending"),
    /** Operator who took the decision. */
    reviewedBy: text("reviewed_by"),
    rejectionReason: text("rejection_reason"),
    payoutReference: text("payout_reference"),
  },
  (table) => [
    index("withdrawals_user_idx").on(table.userId),
    index("withdrawals_status_idx").on(table.status),
    index("withdrawals_requested_idx").on(table.requestedAt),
  ],
);
