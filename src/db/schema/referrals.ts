import { index, integer, jsonb, pgTable, smallint, text } from "drizzle-orm/pg-core";

import { percent, ts, usdt } from "./columns";
import { commissionStatusEnum, referralStatusEnum, vipLevelEnum } from "./enums";
import { users } from "./users";

/**
 * VIP levels: commission percentages and the thresholds that unlock them.
 *
 * These are configuration, not code. They were already expressed as data in
 * `@/data/referrals` for exactly this reason, and both applications read the
 * same rows — the CRM must never show a different commission rate from the one
 * the user was promised.
 */
export const vipLevels = pgTable("vip_levels", {
  id: vipLevelEnum("id").primaryKey(),
  name: text("name").notNull(),
  /** Commission on a direct referral's allocation. */
  tier1CommissionPercent: percent("tier1_commission_percent").notNull(),
  /** Commission on a second-tier allocation. */
  tier2CommissionPercent: percent("tier2_commission_percent").notNull(),
  requiredActiveReferrals: integer("required_active_referrals").notNull().default(0),
  requiredTeamVolumeUsdt: usdt("required_team_volume_usdt").notNull().default(0),
  benefits: jsonb("benefits").$type<string[]>().notNull().default([]),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * The referral edge: who introduced whom.
 *
 * `referredUserId` is nullable because an introduction can exist before the
 * invitee has an account of their own on the platform; the display name and
 * masked email are what the referrer is shown either way. The user-facing list
 * masks the email — a referrer is never shown a full contact address.
 */
export const referrals = pgTable(
  "referrals",
  {
    id: text("id").primaryKey(),
    referrerUserId: text("referrer_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    referredUserId: text("referred_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    maskedEmail: text("masked_email").notNull(),
    joinedAt: ts("joined_at").notNull(),
    status: referralStatusEnum("status").notNull().default("registered"),
    /** Total the referral has allocated. */
    investedAmount: usdt("invested_amount").notNull().default(0),
    /** Commission this referral has generated for the referrer. */
    earnedFromReferral: usdt("earned_from_referral").notNull().default(0),
    /** 1 = direct, 2 = second tier. */
    tier: smallint("tier").notNull().default(1),
  },
  (table) => [
    index("referrals_referrer_idx").on(table.referrerUserId),
    index("referrals_referred_idx").on(table.referredUserId),
  ],
);

/**
 * Per-user referral aggregates.
 *
 * One row feeds two screens: the user's `ReferralSummary` and the CRM's
 * `AdminReferralAccount`. Stored rather than computed on read because both are
 * list screens — the CRM's referrals table would otherwise run four aggregates
 * per row.
 */
export const referralAccounts = pgTable("referral_accounts", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  directReferrals: integer("direct_referrals").notNull().default(0),
  indirectReferrals: integer("indirect_referrals").notNull().default(0),
  activeReferrals: integer("active_referrals").notNull().default(0),
  teamVolumeUsdt: usdt("team_volume_usdt").notNull().default(0),
  commissionEarnedUsdt: usdt("commission_earned_usdt").notNull().default(0),
  commissionPendingUsdt: usdt("commission_pending_usdt").notNull().default(0),
  joinedAt: ts("joined_at").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * The commission ledger.
 *
 * INTEGRATION POINT: a real referral service writes these when an allocation
 * settles, and credits the beneficiary's wallet in the same transaction.
 */
export const commissionEntries = pgTable(
  "commission_entries",
  {
    id: text("id").primaryKey(),
    /** Who was paid. */
    beneficiaryUserId: text("beneficiary_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Whose allocation generated it. Null once that account is removed. */
    sourceUserId: text("source_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    sourceUserName: text("source_user_name").notNull(),
    tier: smallint("tier").notNull().default(1),
    amountUsdt: usdt("amount_usdt").notNull(),
    sourcePlanName: text("source_plan_name").notNull(),
    createdAt: ts("created_at").notNull(),
    status: commissionStatusEnum("status").notNull().default("pending"),

    /**
     * When this entry becomes payable, computed once at accrual.
     *
     * WHY A COLUMN AND NOT A RULE APPLIED AT RELEASE TIME
     * ---------------------------------------------------
     * The delay is `platform_settings.referrals.payoutDelayDays`, which an
     * operator can change. If the scheduler applied it at release time, an
     * operator lengthening the delay would push back commission that had
     * already been promised a date — and shortening it would pay out entries
     * accrued under different terms. Stamping it at accrual means every entry
     * carries the schedule it was accrued under, the same snapshot rule
     * `investments` follows for a plan's rate.
     *
     * Null on entries accrued before this column existed; the release job
     * treats a null as "not scheduled" and leaves it to an operator, because
     * inventing a date for a historical entry is inventing a payment date.
     */
    releaseAt: ts("release_at"),
    /**
     * When it was actually paid. Set in the same transaction as the ledger
     * entry and the status change, by `releaseCommission` — the only function
     * that moves this money, whether an operator or the scheduler called it.
     */
    releasedAt: ts("released_at"),
  },
  (table) => [
    index("commission_entries_beneficiary_idx").on(table.beneficiaryUserId),
    index("commission_entries_created_idx").on(table.createdAt),
    index("commission_entries_status_idx").on(table.status),
    /**
     * The release job's own index: "pending entries whose time has come".
     * Without it the nightly pass sequentially scans the whole ledger.
     */
    index("commission_entries_release_idx").on(table.status, table.releaseAt),
  ],
);
