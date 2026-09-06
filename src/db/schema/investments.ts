import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { ts, usdt } from "./columns";
import {
  investmentStatusEnum,
  rewardFrequencyEnum,
  riskLevelEnum,
} from "./enums";
import { plans } from "./plans";
import { users } from "./users";

/**
 * A user's allocation into a plan.
 *
 * `planName`, `rewardFrequency` and `risk` are copied onto the row rather than
 * joined at read time. That is deliberate: an operator editing a plan's terms
 * must not retroactively rewrite what an existing allocation was sold as. The
 * plan reference stays for navigation; the terms are a snapshot.
 */
export const investments = pgTable(
  "investments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    planName: text("plan_name").notNull(),
    amount: usdt("amount").notNull(),
    /** Profit credited so far. Never presented as guaranteed. */
    profit: usdt("profit").notNull().default(0),
    /** Total profit projected at maturity, at the terms sold. */
    projectedProfit: usdt("projected_profit").notNull().default(0),
    startedAt: ts("started_at").notNull(),
    maturesAt: ts("matures_at").notNull(),
    durationDays: integer("duration_days").notNull(),
    elapsedDays: integer("elapsed_days").notNull().default(0),
    status: investmentStatusEnum("status").notNull().default("active"),
    rewardFrequency: rewardFrequencyEnum("reward_frequency").notNull(),
    /** Null once matured. */
    nextRewardAt: ts("next_reward_at"),
    nextRewardAmount: usdt("next_reward_amount"),
    risk: riskLevelEnum("risk").notNull(),
    /**
     * How many scheduled earning periods have actually been credited so far.
     *
     * The engine's own cursor, not a display figure: it is what lets a
     * settlement pass ask "which period is next" instead of re-attempting
     * every period from the start of the term on every tick. Advanced only by
     * `recordInvestmentEarning()`, and only up (`greatest(…)`), so two
     * concurrent settlement attempts that credit different periods out of
     * order cannot walk it backwards. Zero for an allocation nothing has
     * credited yet, which is every allocation created before this engine
     * existed and every one created after it.
     */
    earningsCreditedPeriods: integer("earnings_credited_periods").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("investments_user_idx").on(table.userId),
    index("investments_plan_idx").on(table.planId),
    index("investments_status_idx").on(table.status),
    index("investments_started_idx").on(table.startedAt),
  ],
);

/**
 * A reward credited against an allocation.
 *
 * Separate from `transactions` because the two answer different questions: the
 * ledger says the wallet went up by 23.40 USDT, this says which allocation
 * earned it and for which period. Reporting needs the second; the balance needs
 * the first. They are written together, in one transaction, and `ledgerTxId`
 * links them.
 *
 * `periodKey` is the idempotency key — `"p1"`, `"p2"`, … — one per scheduled
 * period counted from the allocation's own `started_at`, in order, regardless
 * of the wall-clock date the settlement job happens to run on. A scheduler
 * that runs twice, or is replayed after a failure, collides on the unique
 * index instead of paying twice; a scheduler that runs late still produces the
 * same key for the period it is late for.
 *
 * Written by `/api/cron/settle-investments` via
 * `creditDueEarnings()` in `investment-settlement.service.ts`, for every
 * fixed-term allocation on the reward schedule its plan was sold with — see
 * CLAUDE.md §10a.
 */
export const investmentEarnings = pgTable(
  "investment_earnings",
  {
    id: text("id").primaryKey(),
    investmentId: text("investment_id")
      .notNull()
      .references(() => investments.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: usdt("amount").notNull(),
    /** The accrual period this settles, and the reason it can only settle once. */
    periodKey: text("period_key").notNull(),
    earnedAt: ts("earned_at").notNull(),
    creditedAt: ts("credited_at"),
    /** The ledger entry that moved the money. */
    ledgerTxId: text("ledger_tx_id"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("investment_earnings_period_key").on(
      table.investmentId,
      table.periodKey,
    ),
    index("investment_earnings_user_idx").on(table.userId),
    index("investment_earnings_investment_idx").on(table.investmentId),
  ],
);
