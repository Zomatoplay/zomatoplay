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
