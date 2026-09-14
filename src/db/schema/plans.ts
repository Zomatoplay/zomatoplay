import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { percent, ts, usdt } from "./columns";
import {
  depositNetworkEnum,
  planStatusEnum,
  rewardFrequencyEnum,
  riskLevelEnum,
} from "./enums";
import type { PlanHighlight } from "@/types";

/**
 * The investment product catalogue — one table serving both applications.
 *
 * The user app reads the marketing projection (`Plan`), the CRM reads the
 * operational one (`AdminPlan`). They were never two datasets; the CRM's
 * mock module already derived itself from the public catalogue precisely so
 * they could not drift, and a single table makes that structural.
 *
 * The long-form copy blocks are `jsonb` string arrays rather than child tables:
 * they are ordered prose rendered as a unit, never queried, never joined.
 */
export const plans = pgTable(
  "plans",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline").notNull(),
    description: text("description").notNull(),
    howItWorks: jsonb("how_it_works").$type<string[]>().notNull().default([]),
    minInvestment: usdt("min_investment").notNull(),
    maxInvestment: usdt("max_investment").notNull(),
    /** 0 means an open-ended plan with no lock-in. */
    durationDays: integer("duration_days").notNull(),
    /** Projected total return over the term. Never presented as guaranteed. */
    estimatedReturnPercent: percent("estimated_return_percent").notNull(),
    /** The projected range, which the UI must always show alongside the figure. */
    estimatedReturnLow: percent("estimated_return_low").notNull(),
    estimatedReturnHigh: percent("estimated_return_high").notNull(),
    rewardFrequency: rewardFrequencyEnum("reward_frequency").notNull(),
    risk: riskLevelEnum("risk").notNull(),
    status: planStatusEnum("status").notNull().default("open"),
    /** Capacity indicator for `limited` plans, 0–100. */
    capacityFilledPercent: integer("capacity_filled_percent"),
    highlights: jsonb("highlights").$type<PlanHighlight[]>().notNull().default([]),
    conditions: jsonb("conditions").$type<string[]>().notNull().default([]),
    riskNotes: jsonb("risk_notes").$type<string[]>().notNull().default([]),
    earlyExit: text("early_exit").notNull(),
    popular: boolean("popular").notNull().default(false),
    /** Catalogue order. The browse screen is curated, not alphabetical. */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * Operational figures the CRM shows. A real products service computes these
     * from the allocation ledger; the aggregate is stored so the plans screen
     * does not fan out a query per card.
     */
    activeInvestments: integer("active_investments").notNull().default(0),
    totalAllocated: usdt("total_allocated").notNull().default(0),
    totalProfitPaid: usdt("total_profit_paid").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("plans_slug_key").on(table.slug),
    index("plans_status_idx").on(table.status),
  ],
);

/**
 * A record of a plan's profit rate changing.
 *
 * WHY THIS EXISTS
 * ----------------
 * `plans.estimated_return_percent` is now the rate the settlement engine
 * actually pays (CLAUDE.md §10a), not only a marketing projection. An operator
 * editing it in `/admin/plans` is therefore a financially meaningful act, and
 * `updatePlanAction` used to just overwrite the column — the old figure was
 * gone the moment the new one was saved, recoverable only by reading
 * `audit_logs.details` as prose.
 *
 * WHAT MAKES HISTORICAL EARNINGS SAFE FROM A RATE CHANGE
 * -------------------------------------------------------
 * This table is a record of what changed and when — it is not consulted by
 * the settlement engine. That is deliberate, not an oversight: `investments`
 * already copies `plan_name`, `reward_frequency` and, via `projected_profit`,
 * the rate itself onto the allocation row at the moment it is created (the
 * comment at the top of `investments.ts` has said "the plan reference stays
 * for navigation; the terms are a snapshot" since before this table existed).
 * A running allocation's schedule is entirely a function of its own
 * `projected_profit`, `duration_days` and `started_at` — none of which this
 * table, or a later edit to `plans`, ever touches. So:
 *
 *   - an allocation's periods already credited keep the amount they were
 *     credited at, because nothing rewrites a credited `investment_earnings`
 *     row;
 *   - an allocation's periods **not yet credited** are still paid at the rate
 *     the allocation was sold at, because they are computed from its own
 *     `projected_profit`, not from `plans.estimated_return_percent`;
 *   - only an allocation created **after** the change reads the new rate,
 *     because `createInvestment` reads `plans` at the moment it runs.
 *
 * "All users enrolled in the same plan are governed by the same effective
 * rate from that point forward" therefore means new enrollments, not a
 * retroactive repricing of a contract already sold — the same rule this
 * codebase already applies to a plan's name and term, extended to its rate.
 * Recomputing a *running* allocation's remaining periods against a new rate
 * was considered and rejected: nothing in the product's terms tells a
 * customer their return can change mid-term, and doing it anyway would be
 * inventing a rule on the one table where inventing rules pays real money.
 */
export const planRateHistory = pgTable(
  "plan_rate_history",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    /** Null only for the row written at plan creation, which has no "before". */
    previousRatePercent: percent("previous_rate_percent"),
    newRatePercent: percent("new_rate_percent").notNull(),
    /** When the new rate took effect — always "now" from the operator's edit. */
    effectiveAt: ts("effective_at").notNull(),
    /** The operator (or `system` for the seed/creation row) who made the change. */
    changedByActorId: text("changed_by_actor_id").notNull(),
    changedByLabel: text("changed_by_label").notNull(),
    reason: text("reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("plan_rate_history_plan_idx").on(table.planId, table.effectiveAt),
  ],
);

/**
 * Deposit networks and their receiving addresses.
 *
 * INTEGRATION POINT: the deposit service issues an address per user, so this
 * becomes the network *catalogue* and the address moves to a per-user table.
 * Nothing here is a real wallet.
 */
export const depositNetworks = pgTable("deposit_networks", {
  id: depositNetworkEnum("id").primaryKey(),
  name: text("name").notNull(),
  chain: text("chain").notNull(),
  address: text("address").notNull(),
  minDeposit: usdt("min_deposit").notNull(),
  estimatedArrival: text("estimated_arrival").notNull(),
  requiredConfirmations: integer("required_confirmations").notNull(),
  networkFeeNote: text("network_fee_note").notNull(),
  recommended: boolean("recommended").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * A plan's amount-banded rate ladder.
 *
 * WHAT A ROW MEANS
 * ----------------
 * "An allocation of at least `min_amount_usdt`, and strictly below
 * `max_amount_usdt` when that is set, is sold at `rate_percent`." The band is
 * **half-open — `[min, max)`** — which is what makes the boundaries
 * unambiguous: 49.99 is in `[10, 50)`, 50 is in `[50, 100)`, and no amount is
 * ever in two bands at once. `max_amount_usdt` is null on the top band only,
 * meaning "and everything above".
 *
 * THE RATE MEANS WHAT `plans.estimated_return_percent` MEANS
 * ----------------------------------------------------------
 * Total projected return over the plan's whole term, non-compounding — the
 * figure `createInvestment` applies once, via `applyPercent()`, to produce
 * `investments.projected_profit` (CLAUDE.md §10a). It is **not** a periodic
 * rate: a 3% band on a 90-day weekly-reward plan pays 3% across the term,
 * split evenly across its thirteen periods, not 3% a week. Introducing a
 * periodic rate would mean a second meaning for the same column type and a
 * conversion formula nobody has written down; the reward *cadence* already
 * lives on `plans.reward_frequency` and is the only thing that decides period
 * length.
 *
 * WHY A TABLE AND NOT JSON ON `plans`
 * -----------------------------------
 * Bands are queried (resolve one by amount), validated against each other
 * (no overlap, no gap, no duplicate boundary) and edited individually. A jsonb
 * blob would make every one of those a read-modify-write of the whole ladder,
 * which is exactly the shape that loses a concurrent edit.
 *
 * WHAT A CHANGE HERE DOES TO A RUNNING ALLOCATION: NOTHING.
 * --------------------------------------------------------
 * The same rule `plan_rate_history` documents. `createInvestment` resolves the
 * band once, copies its id, its bounds and its rate onto the `investments` row
 * and computes `projected_profit` from that copy. Nothing re-reads this table
 * for an allocation that already exists — so editing, deactivating or deleting
 * a band never reprices a contract already sold, and only allocations made
 * after the edit see the new ladder.
 */
export const planRateTiers = pgTable(
  "plan_rate_tiers",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    /** Inclusive lower bound. */
    minAmountUsdt: usdt("min_amount_usdt").notNull(),
    /** Exclusive upper bound. Null means open-ended — the top band. */
    maxAmountUsdt: usdt("max_amount_usdt"),
    /** Projected total return over the term, for allocations in this band. */
    ratePercent: percent("rate_percent").notNull(),
    /**
     * An inactive band is ignored by resolution but kept for the audit trail:
     * an allocation that cites it must still be explainable afterwards.
     */
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    /**
     * Ordering is by lower bound, and the bound is unique per plan — so a
     * ladder has exactly one band starting at any amount, and "the band after
     * this one" is a well-defined question. Overlap and gap checking is done
     * in the write service, which is the only place a whole ladder is visible
     * at once; this index is what stops two concurrent edits producing two
     * bands with the same start.
     */
    uniqueIndex("plan_rate_tiers_plan_min_key").on(table.planId, table.minAmountUsdt),
    index("plan_rate_tiers_plan_idx").on(table.planId, table.minAmountUsdt),
    /*
     * The three rules that can be stated about a band on its own, stated to
     * Postgres. Overlap and gap are properties of a *ladder* and are checked in
     * the write service, where the whole ladder is in hand; these are the ones
     * no amount of application care should be the only thing enforcing, because
     * a band with an upper bound below its lower bound can never match anything
     * and a zero rate is an allocation sold at no return.
     */
    check("plan_rate_tiers_min_non_negative", sql`${table.minAmountUsdt} >= 0`),
    check(
      "plan_rate_tiers_bounds_ordered",
      sql`${table.maxAmountUsdt} is null or ${table.maxAmountUsdt} > ${table.minAmountUsdt}`,
    ),
    check("plan_rate_tiers_rate_positive", sql`${table.ratePercent} > 0`),
  ],
);
