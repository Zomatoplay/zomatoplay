import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

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
