import "server-only";

import {
  adminAgents as seedAgents,
  adminDeposits as seedDeposits,
  adminInvestments as seedInvestments,
  adminReferralAccounts as seedReferralAccounts,
  adminCommissionLedger as seedCommissionLedger,
  adminUsers as seedUsers,
  adminWithdrawals as seedWithdrawals,
  auditLogEntries as seedAuditLog,
  kycSubmissions as seedKycSubmissions,
  notificationCampaigns as seedCampaigns,
  platformSettings as seedSettings,
  userDeviceSessions as seedDeviceSessions,
  userSecurityEvents as seedSecurityEvents,
} from "@/data/admin";
import { adminPlans as seedAdminPlans } from "@/data/admin/plans";
import type {
  AdminAgent,
  PipelineEvent,
  AdminCommissionEntry,
  AdminDeposit,
  AdminInvestment,
  AdminNotificationCampaign,
  AdminPlan,
  AdminReferralAccount,
  AdminUser,
  AdminWithdrawal,
  AuditLogEntry,
  KycSubmission,
  PlatformSettings,
  UserDeviceSession,
  UserSecurityEvent,
} from "@/types/admin";

import { fromDatabase } from "../database";
import {
  findPlatformSettings,
  listAdminAgents,
  listAuditLog,
  listPlanRateHistory,
  type PlanRateHistoryEntry,
} from "../repositories/admin.repository";
import { listAdminPlans } from "../repositories/catalogue.repository";
import { listNotificationCampaigns } from "../repositories/engagement.repository";
import { listAdminInvestments } from "../repositories/investments.repository";
import { listKycSubmissions } from "../repositories/kyc.repository";
import { listPipelineEvents } from "../repositories/pipeline.repository";
import {
  listAdminDeposits,
  listAdminWithdrawals,
} from "../repositories/ledger.repository";
import {
  listAdminCommissionLedger,
  listAdminReferralAccounts,
} from "../repositories/referrals.repository";
import {
  listAdminUsers,
  listUserDeviceSessions,
  listUserSecurityEvents,
} from "../repositories/users.repository";

/**
 * Reads for the Master CRM.
 *
 * ONE SLICE PER SCREEN
 * --------------------
 * Every getter below is read by the *page* that needs it, not by the layout.
 * The layout used to call `getAdminSeed()` — all fourteen of these at once — on
 * every admin page load, which was two problems wearing one coat:
 *
 *  - **Cost.** Fourteen queries against a database with a ~200ms round-trip
 *    floor, contending for a five-connection pool, measured at 2.2s. The
 *    deposits screen paid for the audit log; the plans screen paid for every
 *    user's device sessions.
 *  - **Staleness.** Next.js re-renders only the route segments that changed on
 *    a client navigation, so a layout does not run again. The snapshot taken
 *    when the console was opened was the one every screen kept rendering, and a
 *    verification case submitted a minute later did not appear until somebody
 *    hard-reloaded. That is the "user submitted KYC but the CRM cannot see it"
 *    report, and it was never a write problem — the row was always there.
 *
 * `getAdminShell()` is what the layout reads now: the little that the sidebar
 * and the permission gates need.
 *
 * The seed-data fallback stays on these reads. Unlike a user-scoped read, this
 * data belongs to the platform rather than to a person, so serving the sample
 * dataset with no database configured shows nobody anybody else's balance.
 */

export async function getAdminUsers(): Promise<AdminUser[]> {
  return fromDatabase(listAdminUsers, () => seedUsers);
}

export async function getAdminPlans(): Promise<AdminPlan[]> {
  return fromDatabase(listAdminPlans, () => seedAdminPlans);
}

/**
 * A plan's recorded rate changes, newest first. No seed equivalent — the
 * history starts the first time a real plan is created or edited, and an
 * empty list with no database configured is the honest answer for a feature
 * with no mock predecessor.
 */
export async function getPlanRateHistory(planId: string): Promise<PlanRateHistoryEntry[]> {
  return fromDatabase((db) => listPlanRateHistory(db, planId), () => []);
}

export async function getKycSubmissions(): Promise<KycSubmission[]> {
  return fromDatabase(listKycSubmissions, () => seedKycSubmissions);
}

export async function getAdminDeposits(): Promise<AdminDeposit[]> {
  return fromDatabase(listAdminDeposits, () => seedDeposits);
}

export async function getAdminWithdrawals(): Promise<AdminWithdrawal[]> {
  return fromDatabase(listAdminWithdrawals, () => seedWithdrawals);
}

export async function getAdminInvestments(): Promise<AdminInvestment[]> {
  return fromDatabase(listAdminInvestments, () => seedInvestments);
}

export async function getAdminReferralAccounts(): Promise<
  AdminReferralAccount[]
> {
  return fromDatabase(listAdminReferralAccounts, () => seedReferralAccounts);
}

export async function getAdminCommissionLedger(): Promise<
  AdminCommissionEntry[]
> {
  return fromDatabase(listAdminCommissionLedger, () => seedCommissionLedger);
}

export async function getAdminAgents(): Promise<AdminAgent[]> {
  return fromDatabase(listAdminAgents, () => seedAgents);
}

export async function getUserDeviceSessions(): Promise<UserDeviceSession[]> {
  return fromDatabase(listUserDeviceSessions, () => seedDeviceSessions);
}

export async function getUserSecurityEvents(): Promise<UserSecurityEvent[]> {
  return fromDatabase(listUserSecurityEvents, () => seedSecurityEvents);
}

export async function getNotificationCampaigns(): Promise<
  AdminNotificationCampaign[]
> {
  return fromDatabase(listNotificationCampaigns, () => seedCampaigns);
}

export async function getAuditLog(): Promise<AuditLogEntry[]> {
  return fromDatabase((db) => listAuditLog(db), () => seedAuditLog);
}

/**
 * The system log.
 *
 * The one admin read with **no seed-data fallback**, deliberately. Every other
 * getter here describes the platform, and the sample dataset is a reasonable
 * stand-in when there is no database. This one describes what the system
 * actually did — an empty list is the truthful answer when nothing has been
 * recorded, and a fixture would make the screen that exists to diagnose
 * problems the one screen guaranteed to be fiction.
 */
export async function getPipelineEvents(): Promise<PipelineEvent[]> {
  return fromDatabase(
    (db) => listPipelineEvents(db),
    () => [],
  );
}

export async function getPlatformSettings(): Promise<PlatformSettings> {
  return fromDatabase(
    async (db) => (await findPlatformSettings(db)) ?? seedSettings,
    () => seedSettings,
  );
}

/**
 * What the console's frame needs, and nothing else.
 *
 * **One query.** Platform settings is a single row and it is genuinely shell
 * data: currency, fee and display configuration that several screens format
 * against, cheap enough that reading it per request is not worth a cache.
 *
 * THE OPERATOR DIRECTORY USED TO BE HERE, AND IT WAS THE SAME MISTAKE TWICE
 * -------------------------------------------------------------------------
 * `agents` was the fourteenth slice, left behind when the other thirteen moved
 * out. Reading it cost **two statements on every admin page load** — the agents
 * table and then its permission grants — to serve exactly two screens:
 * `/admin/agents`, which already reads its own fresher copy, and
 * `/admin/audit-logs`, which resolves actor names against it.
 *
 * Measured: eight rapid admin navigations issued 63 SQL statements against a
 * pool of five, of which sixteen were this. Both screens now read it
 * themselves, in parallel with their own slice, so it costs one round trip on
 * two routes instead of two round trips on thirteen.
 *
 * It also fixes a staleness bug of exactly the kind this split exists to
 * prevent: a layout does not re-run on a client navigation, so the audit log
 * was resolving names against whatever the directory looked like when the
 * console was opened.
 */
export interface AdminShellData {
  settings: PlatformSettings;
}

export async function getAdminShell(): Promise<AdminShellData> {
  return { settings: await getPlatformSettings() };
}

/**
 * The slices a page can hand to the store.
 *
 * Every field optional: a page provides what it renders and leaves the rest
 * alone, so the deposits screen does not overwrite the KYC queue with an empty
 * array on its way past.
 */
export interface AdminSliceData {
  users?: AdminUser[];
  pipelineEvents?: PipelineEvent[];
  kyc?: KycSubmission[];
  deposits?: AdminDeposit[];
  withdrawals?: AdminWithdrawal[];
  investments?: AdminInvestment[];
  plans?: AdminPlan[];
  agents?: AdminAgent[];
  sessions?: UserDeviceSession[];
  securityEvents?: UserSecurityEvent[];
  referralAccounts?: AdminReferralAccount[];
  commissionLedger?: AdminCommissionEntry[];
  campaigns?: AdminNotificationCampaign[];
  auditLog?: AuditLogEntry[];
  settings?: PlatformSettings;
}
