import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type { DepositRequestCancellationReason } from "@/types";

import { inr, rate, ts, usdt } from "./columns";
import {
  chainEnum,
  chainNetworkEnum,
  currencyEnum,
  depositAssetEnum,
  depositRequestStatusEnum,
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
     *
     * `.nullsFirst()` IS LOAD-BEARING, and leaving it off silently disables
     * this index. Drizzle's `.desc()` on an index column emits
     * `DESC NULLS LAST`, but `orderBy(desc(...))` in a query emits a bare
     * `DESC` — and SQL's default for `DESC` is NULLS **FIRST**. Postgres
     * matches an ordering by its null placement as well as its direction, and
     * it does that literally: the column is `not null`, so the two orderings
     * cannot actually differ, and the planner still refuses the index. Built
     * `DESC NULLS LAST` (migration 0017) the planner ignored it entirely and
     * kept sorting; measured on 202k rows, an account holding 2,000 of them:
     * 3.9-6.3ms discarding 5,135 rows, against 2.6ms scanning this index with
     * no filter once the two agree. If you ever change the `orderBy` here,
     * change this to match it.
     */
    index("transactions_user_recent_idx").on(
      table.userId,
      table.occurredAt.desc().nullsFirst(),
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
    /**
     * Why a confirmed transfer could not be matched to a deposit request, and
     * so waits for an operator: `no_matching_request`, `ambiguous_match`,
     * `outside_request_window`, `legacy_address`, `no_block_time`. Null once
     * attributed, and null on rows from before deposit requests existed.
     */
    unmatchedReason: text("unmatched_reason"),

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
 * A customer's intention to deposit, created before any money moves.
 *
 * WHY THIS TABLE EXISTS
 * ---------------------
 * Nanotron receives every deposit at ONE configured address
 * (`deposit_settings`). A transfer to a shared address says nothing about who
 * sent it, and the obvious fix — let the customer paste their transaction hash —
 * is not a fix on its own: the chain is public, so anybody can watch the
 * address, see a stranger's transfer land and submit that hash first
 * (CLAUDE.md §18.4).
 *
 * What binds a transfer to a person here is the **exact amount inside a time
 * window**. Creating a request quotes an `expected_amount_usdt` — the amount
 * asked for plus a random fraction of a cent-scale offset — that no other open
 * request holds. A transfer is attributed to a request only when its on-chain
 * amount equals that figure and its block time falls inside the request's
 * window. Anything else waits for an operator. The transaction hash the
 * customer submits is a *pointer* that lets the server look the transfer up
 * sooner; it is never the thing that decides whose it is.
 *
 * `id` is the customer-facing reference, `DEP-XXXXXXXX`. It is Nanotron's, and
 * it is deliberately a different shape from a transaction hash (64 hex
 * characters) so the two cannot be confused on screen or in support.
 */
export const depositRequests = pgTable(
  "deposit_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    chain: chainEnum("chain").notNull().default("tron"),
    chainNetwork: chainNetworkEnum("chain_network").notNull(),
    asset: depositAssetEnum("asset").notNull().default("usdt"),
    /**
     * The configured deposit address at the moment the request was created.
     * Copied, not joined: an operator changing the address must not change
     * where an already-quoted request told somebody to send money.
     */
    receivingAddress: text("receiving_address").notNull(),

    /** What the customer asked to deposit. */
    requestedAmountUsdt: usdt("requested_amount_usdt").notNull(),
    /** The exact amount they were told to send — the binding. */
    expectedAmountUsdt: usdt("expected_amount_usdt").notNull(),

    status: depositRequestStatusEnum("status").notNull().default("awaiting_payment"),

    /**
     * The hash the customer submitted. A claim, not a binding: it may be
     * wrong, somebody else's, or not yet indexed. Not unique — two people
     * claiming one transfer is exactly the dispute an operator must see.
     */
    submittedTxHash: text("submitted_tx_hash"),
    submittedAt: ts("submitted_at"),

    /** The chain deposit this request was satisfied by. The binding. */
    depositId: text("deposit_id").references(() => deposits.id, {
      onDelete: "set null",
    }),
    /** From the chain, never from the browser. */
    verifiedAmountUsdt: usdt("verified_amount_usdt"),
    verifiedAt: ts("verified_at"),
    /** Why it needs a person — shown to the operator, summarised to the customer. */
    reviewReason: text("review_reason"),

    /**
     * Set when the customer changed the amount or left the deposit screen.
     * Cancelling is a state, never a deletion: the row, and anything already
     * submitted against it, stays. See `cancelDepositRequest`.
     */
    cancelledAt: ts("cancelled_at"),
    cancellationReason: text("cancellation_reason").$type<DepositRequestCancellationReason>(),

    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("deposit_requests_user_idx").on(table.userId, table.createdAt),
    index("deposit_requests_status_idx").on(table.status),
    index("deposit_requests_submitted_tx_idx").on(table.submittedTxHash),
    /* One transfer satisfies at most one request, enforced by Postgres. */
    uniqueIndex("deposit_requests_deposit_key")
      .on(table.depositId)
      .where(sql`${table.depositId} is not null`),
    /*
     * The exact amount is unique among OPEN requests at one address — the
     * property attribution rests on. The service also picks amounts that
     * avoid every unexpired window; this is the backstop a race cannot pass.
     */
    uniqueIndex("deposit_requests_open_amount_key")
      .on(table.chainNetwork, table.receivingAddress, table.expectedAmountUsdt)
      .where(sql`${table.status} in ('awaiting_payment', 'verifying')`),
    /*
     * At most one request per customer is waiting for payment. Changing the
     * amount cancels the old one in the same transaction as creating the new
     * one; this is what makes "two live requests" impossible rather than
     * merely unlikely.
     */
    uniqueIndex("deposit_requests_one_awaiting_per_user_key")
      .on(table.userId)
      .where(sql`${table.status} = 'awaiting_payment'`),
    /* The matcher's lookup: this address, this amount. */
    index("deposit_requests_match_idx").on(
      table.receivingAddress,
      table.expectedAmountUsdt,
    ),
  ],
);

/**
 * The one address Nanotron receives deposits at, per chain and network.
 *
 * Replaces the per-user deposit-address pool (`deposit_addresses`, kept for
 * its history). Written only by an operator holding `manage` over `deposits`,
 * through `setDepositAddress`, with an audit entry naming the old and new
 * address in the same transaction. Absent a row, the deployment's
 * `TRON_PLATFORM_DEPOSIT_ADDRESS` is used — so introducing this table changes
 * nothing about where money is sent until somebody deliberately saves one.
 */
export const depositSettings = pgTable(
  "deposit_settings",
  {
    id: text("id").primaryKey(),
    chain: chainEnum("chain").notNull().default("tron"),
    chainNetwork: chainNetworkEnum("chain_network").notNull(),
    asset: depositAssetEnum("asset").notNull().default("usdt"),
    receivingAddress: text("receiving_address").notNull(),
    updatedAt: ts("updated_at").notNull(),
    /** The operator's agent id and name, copied as `audit_logs` copies them. */
    updatedById: text("updated_by_id"),
    updatedByName: text("updated_by_name"),
  },
  (table) => [
    uniqueIndex("deposit_settings_target_key").on(
      table.chain,
      table.chainNetwork,
      table.asset,
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

/**
 * A manual USDT credit an operator made to a customer's wallet.
 *
 * The money itself moves through the ledger like every other movement — one
 * `transactions` row of type `adjustment`, applied by `applyLedgerEntry` in the
 * same transaction as this row and its audit entry. This table is the
 * *decision* record: who credited, how much, why, and the key that makes the
 * action idempotent.
 *
 * Append-only. Nothing updates or deletes a row; a mistaken credit is
 * corrected by a new, separately audited movement, never by editing history.
 *
 * `idempotency_key` is unique: the confirmation dialog generates one key per
 * confirmation, so a double-click, a retried request or a replayed action
 * inserts nothing the second time and credits nothing twice.
 */
export const manualCredits = pgTable(
  "manual_credits",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    amountUsdt: usdt("amount_usdt").notNull(),
    /** The operator's internal note. Never shown to the customer. */
    note: text("note"),
    idempotencyKey: text("idempotency_key").notNull(),
    /** The ledger entry that moved the money. */
    ledgerTxId: text("ledger_tx_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "restrict" }),
    createdById: text("created_by_id").notNull(),
    /** Copied, not joined — same reason as `audit_logs.actor_name`. */
    createdByName: text("created_by_name").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("manual_credits_idempotency_key").on(table.idempotencyKey),
    index("manual_credits_user_idx").on(table.userId),
    index("manual_credits_created_idx").on(table.createdAt),
    check("manual_credits_amount_positive", sql`${table.amountUsdt} > 0`),
  ],
);
