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
  AdminDashboardMetrics,
  PipelineEvent,
  AdminCommissionEntry,
  AdminDeposit,
  AdminInvestment,
  AdminNotificationCampaign,
  AdminPlan,
  AdminReferralAccount,
  AdminReferralsSummary,
  AdminUser,
  AdminUserOption,
  AdminWithdrawal,
  AdminDepositsSummary,
  AdminInvestmentsSummary,
  AdminListPage,
  AdminListQuery,
  AdminWithdrawalsSummary,
  AuditLogEntry,
  KycSubmission,
  PlatformSettings,
  UserDeviceSession,
  UserSecurityEvent,
} from "@/types/admin";

import { fromDatabase } from "../database";
import {
  pageSeed,
  seedSearchMatches,
  seedStatusCounts,
} from "./admin-seed-page";
import {
  findPlatformSettings,
  listAdminAgents,
  listAuditLog,
  listPlanRateHistory,
  readDashboardMetrics,
  type PlanRateHistoryEntry,
} from "../repositories/admin.repository";
import { listAdminPlans } from "../repositories/catalogue.repository";
import { listNotificationCampaigns } from "../repositories/engagement.repository";
import {
  countAdminInvestmentsByStatus,
  listAdminInvestments,
  pageAdminInvestments,
  readInvestmentsSummary,
} from "../repositories/investments.repository";
import {
  countKycSubmissionsByStatus,
  listKycSubmissions,
  pageKycSubmissions,
} from "../repositories/kyc.repository";
import { listPipelineEvents } from "../repositories/pipeline.repository";
import {
  countAdminDepositsByStatus,
  countAdminWithdrawalsByStatus,
  listAdminDeposits,
  listAdminWithdrawals,
  pageAdminDeposits,
  pageAdminWithdrawals,
  readDepositsSummary,
  readWithdrawalsSummary,
} from "../repositories/ledger.repository";
import {
  countCommissionsByStatus,
  countReferralAccountsByVip,
  listAdminCommissionLedger,
  listAdminReferralAccounts,
  pageAdminCommissionLedger,
  pageAdminReferralAccounts,
  readReferralsSummary,
} from "../repositories/referrals.repository";
import {
  countAdminUsersByStatus,
  findAdminUserById,
  listRecentUsers,
  listUserDeviceSessions,
  listUserSecurityEvents,
  pageAdminUsers,
  searchUsersForPicker,
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

/**
 * The fixture equivalent of `pageAdminUsers`'s predicates — see `pageSeed`.
 */
const SEED_KYC_FILTERS: Record<string, readonly AdminUser["kycStatus"][]> = {
  pending: ["not_started", "in_progress", "pending_review"],
  approved: ["verified"],
  rejected: ["rejected"],
};

function seedUserMatcher(user: AdminUser, query: AdminListQuery): boolean {
  if (query.status !== "all" && user.status !== query.status) return false;
  const kyc = SEED_KYC_FILTERS[query.filter];
  if (kyc && !kyc.includes(user.kycStatus)) return false;
  return seedSearchMatches(query.search, [
    user.fullName,
    user.email,
    user.id,
    user.displayId,
    user.phone,
    user.walletAddress,
    user.referralCode,
  ]);
}

/**
 * One page of the user directory.
 *
 * There is deliberately **no `getAdminUsers()`** beside this any more. It read
 * every account joined to every wallet, and by the end three screens were
 * calling it for things that were not a directory: the deposit screen wanted a
 * type-ahead, the notification composer wanted one name, and the user detail
 * page wanted one row. All three are now their own bounded read
 * (`findUsersForPicker`, `findAdminUserById`), and leaving an unbounded
 * full-table read exported with an inviting name is how the next screen
 * acquires one.
 */
export async function getAdminUsersPage(
  query: AdminListQuery,
): Promise<AdminListPage<AdminUser>> {
  return fromDatabase(
    async (db) => {
      // One wave: the page and the chip counts are independent queries over
      // the same table, so issuing them together costs one round trip of wall
      // time rather than two (CLAUDE.md §16.1a).
      const [result, statusCounts] = await Promise.all([
        pageAdminUsers(db, query),
        countAdminUsersByStatus(db, query),
      ]);
      return { result, statusCounts };
    },
    () => ({
      result: pageSeed(seedUsers, query, seedUserMatcher),
      statusCounts: seedStatusCounts(
        seedUsers,
        query,
        seedUserMatcher,
        (user) => user.status,
      ),
    }),
  );
}

/* -------------------------------------------------------------------------- */
/* The paginated queue screens                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Each of these reads one page and the chip counts in a single wave, and each
 * falls back to slicing the fixture array when no database is configured.
 *
 * The fixture matchers below are the only place a screen's predicates are
 * written twice — once in SQL, once over `@/data/admin`. That is the cost of
 * the no-database path (CLAUDE.md §16.3); keeping them adjacent to the service
 * that pairs them is what makes a divergence visible.
 */

/** The fixture path's equivalent of a filtered `sum()`. */
function sumWhere<T>(
  rows: readonly T[],
  keep: (row: T) => boolean,
  value: (row: T) => number,
): number {
  return rows.reduce((sum, row) => (keep(row) ? sum + value(row) : sum), 0);
}

function seedDepositMatcher(
  deposit: AdminDeposit,
  query: AdminListQuery,
): boolean {
  if (query.status === "unmatched") {
    if (!(deposit.status === "confirmed" && deposit.userId === null)) return false;
  } else if (query.status !== "all" && deposit.status !== query.status) {
    return false;
  }
  return seedSearchMatches(query.search, [
    deposit.txHash,
    deposit.walletAddress,
    deposit.id,
    deposit.userName,
    deposit.userDisplayId,
  ]);
}

export async function getAdminDepositsPage(
  query: AdminListQuery,
): Promise<AdminListPage<AdminDeposit> & { summary: AdminDepositsSummary }> {
  return fromDatabase(
    async (db) => {
      const [result, statusCounts, summary] = await Promise.all([
        pageAdminDeposits(db, query),
        countAdminDepositsByStatus(db, query),
        readDepositsSummary(db),
      ]);
      return { result, statusCounts, summary };
    },
    () => ({
      result: pageSeed(seedDeposits, query, seedDepositMatcher),
      statusCounts: seedStatusCounts(
        seedDeposits,
        query,
        seedDepositMatcher,
        (deposit) => deposit.status,
      ),
      summary: {
        creditedUsdt: sumWhere(
          seedDeposits,
          (d) => d.status === "credited",
          (d) => d.amountUsdt,
        ),
        inFlightCount: seedDeposits.filter(
          (d) => d.status !== "credited" && d.status !== "failed",
        ).length,
        inFlightUsdt: sumWhere(
          seedDeposits,
          (d) => d.status !== "credited" && d.status !== "failed",
          (d) => d.amountUsdt,
        ),
      },
    }),
  );
}

function seedWithdrawalMatcher(
  withdrawal: AdminWithdrawal,
  query: AdminListQuery,
): boolean {
  if (query.status !== "all" && withdrawal.status !== query.status) return false;
  return seedSearchMatches(query.search, [
    withdrawal.id,
    withdrawal.userName,
    withdrawal.userDisplayId,
  ]);
}

export async function getAdminWithdrawalsPage(
  query: AdminListQuery,
): Promise<AdminListPage<AdminWithdrawal> & { summary: AdminWithdrawalsSummary }> {
  const isOpen = (w: AdminWithdrawal) =>
    w.status === "pending" ||
    w.status === "under_review" ||
    w.status === "approved" ||
    w.status === "processing";

  return fromDatabase(
    async (db) => {
      const [result, statusCounts, summary] = await Promise.all([
        pageAdminWithdrawals(db, query),
        countAdminWithdrawalsByStatus(db, query),
        readWithdrawalsSummary(db),
      ]);
      return { result, statusCounts, summary };
    },
    () => ({
      result: pageSeed(seedWithdrawals, query, seedWithdrawalMatcher),
      statusCounts: seedStatusCounts(
        seedWithdrawals,
        query,
        seedWithdrawalMatcher,
        (withdrawal) => withdrawal.status,
      ),
      summary: {
        openCount: seedWithdrawals.filter(isOpen).length,
        openUsdt: sumWhere(seedWithdrawals, isOpen, (w) => w.amountUsdt),
        paidNetInr: sumWhere(
          seedWithdrawals,
          (w) => w.status === "paid",
          (w) => w.netInr,
        ),
      },
    }),
  );
}

function seedInvestmentMatcher(
  investment: AdminInvestment,
  query: AdminListQuery,
): boolean {
  if (query.status !== "all" && investment.status !== query.status) return false;
  if (query.filter !== "all" && investment.planId !== query.filter) return false;
  return seedSearchMatches(query.search, [
    investment.id,
    investment.planName,
    investment.userName,
    investment.userDisplayId,
  ]);
}

export async function getAdminInvestmentsPage(
  query: AdminListQuery,
): Promise<AdminListPage<AdminInvestment> & { summary: AdminInvestmentsSummary }> {
  return fromDatabase(
    async (db) => {
      const [result, statusCounts, summary] = await Promise.all([
        pageAdminInvestments(db, query),
        countAdminInvestmentsByStatus(db, query),
        readInvestmentsSummary(db),
      ]);
      return { result, statusCounts, summary };
    },
    () => ({
      result: pageSeed(seedInvestments, query, seedInvestmentMatcher),
      statusCounts: seedStatusCounts(
        seedInvestments,
        query,
        seedInvestmentMatcher,
        (investment) => investment.status,
      ),
      summary: {
        activeCount: seedInvestments.filter((i) => i.status === "active").length,
        totalCount: seedInvestments.length,
        allocatedUsdt: sumWhere(
          seedInvestments,
          (i) => i.status === "active",
          (i) => i.amountUsdt,
        ),
        accruedProfitUsdt: sumWhere(
          seedInvestments,
          () => true,
          (i) => i.profitUsdt,
        ),
      },
    }),
  );
}

function seedKycMatcher(
  submission: KycSubmission,
  query: AdminListQuery,
): boolean {
  if (query.status !== "all" && submission.status !== query.status) return false;
  return seedSearchMatches(query.search, [
    submission.id,
    submission.details.legalName,
    submission.userName,
    submission.userDisplayId,
  ]);
}

export async function getKycSubmissionsPage(
  query: AdminListQuery,
): Promise<AdminListPage<KycSubmission>> {
  return fromDatabase(
    async (db) => {
      const [result, statusCounts] = await Promise.all([
        pageKycSubmissions(db, query),
        countKycSubmissionsByStatus(db, query),
      ]);
      return { result, statusCounts };
    },
    () => ({
      result: pageSeed(seedKycSubmissions, query, seedKycMatcher),
      statusCounts: seedStatusCounts(
        seedKycSubmissions,
        query,
        seedKycMatcher,
        (submission) => submission.status,
      ),
    }),
  );
}

/**
 * Accounts matching a search, for an operator picker. At most eight.
 *
 * Called from a server action rather than rendered into the page, so the
 * directory never has to be in the browser for the dialog to work.
 */
export async function findUsersForPicker(
  search: string,
): Promise<AdminUserOption[]> {
  return fromDatabase(
    (db) => searchUsersForPicker(db, search),
    () =>
      seedUsers
        .filter((user) =>
          seedSearchMatches(search, [
            user.fullName,
            user.email,
            user.id,
            user.displayId,
            user.phone,
            user.walletAddress,
            user.referralCode,
          ]),
        )
        .slice(0, 8)
        .map((user) => ({
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          displayId: user.displayId,
        })),
  );
}

/** One account, for the CRM detail screen. `null` when there is no such id. */
export async function getAdminUser(id: string): Promise<AdminUser | null> {
  return fromDatabase(
    (db) => findAdminUserById(db, id),
    () => seedUsers.find((user) => user.id === id) ?? null,
  );
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

/**
 * One page of referral accounts. The VIP level rides in the `status` slot —
 * it is the dimension this table is triaged by.
 */
export async function getAdminReferralAccountsPage(
  query: AdminListQuery,
): Promise<AdminListPage<AdminReferralAccount>> {
  const matcher = (account: AdminReferralAccount, q: AdminListQuery) => {
    if (q.status !== "all" && account.vipLevel !== q.status) return false;
    return seedSearchMatches(q.search, [
      account.userName,
      account.userDisplayId,
      account.referralCode,
    ]);
  };

  return fromDatabase(
    async (db) => {
      const [result, statusCounts] = await Promise.all([
        pageAdminReferralAccounts(db, query),
        countReferralAccountsByVip(db, query),
      ]);
      return { result, statusCounts };
    },
    () => ({
      result: pageSeed(seedReferralAccounts, query, matcher),
      statusCounts: seedStatusCounts(
        seedReferralAccounts,
        query,
        matcher,
        (account) => account.vipLevel,
      ),
    }),
  );
}

/** One page of the commission ledger. */
export async function getAdminCommissionLedgerPage(
  query: AdminListQuery,
): Promise<AdminListPage<AdminCommissionEntry>> {
  const matcher = (entry: AdminCommissionEntry, q: AdminListQuery) => {
    if (q.status !== "all" && entry.status !== q.status) return false;
    return seedSearchMatches(q.search, [
      entry.beneficiaryName,
      entry.sourceUserName,
      entry.id,
    ]);
  };

  return fromDatabase(
    async (db) => {
      const [result, statusCounts] = await Promise.all([
        pageAdminCommissionLedger(db, query),
        countCommissionsByStatus(db, query),
      ]);
      return { result, statusCounts };
    },
    () => ({
      result: pageSeed(seedCommissionLedger, query, matcher),
      statusCounts: seedStatusCounts(
        seedCommissionLedger,
        query,
        matcher,
        (entry) => entry.status,
      ),
    }),
  );
}

/** The referral screen's stat cards, platform-wide. */
export async function getAdminReferralsSummary(): Promise<AdminReferralsSummary> {
  return fromDatabase(readReferralsSummary, () => ({
    creditedCommissionUsdt: sumWhere(
      seedCommissionLedger,
      (entry) => entry.status === "credited",
      (entry) => entry.amountUsdt,
    ),
    pendingCommissionUsdt: sumWhere(
      seedCommissionLedger,
      (entry) => entry.status === "pending",
      (entry) => entry.amountUsdt,
    ),
    totalTeamVolumeUsdt: sumWhere(
      seedReferralAccounts,
      () => true,
      (account) => account.teamVolumeUsdt,
    ),
  }));
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

/* -------------------------------------------------------------------------- */
/* The dashboard                                                               */
/* -------------------------------------------------------------------------- */

/** How many rows each "recent activity" panel on `/admin` renders. */
const RECENT_PANEL_ROWS = 5;
/** The security timeline shows six, not five. */
const RECENT_SECURITY_ROWS = 6;

export interface AdminDashboardData {
  metrics: AdminDashboardMetrics;
  users: AdminUser[];
  deposits: AdminDeposit[];
  withdrawals: AdminWithdrawal[];
  kyc: KycSubmission[];
  investments: AdminInvestment[];
  securityEvents: UserSecurityEvent[];
}

/**
 * Everything `/admin` renders, and nothing else.
 *
 * WHAT THIS REPLACED
 * ------------------
 * Four unbounded reads — `getAdminUsers()`, `getAdminDeposits()`,
 * `getAdminWithdrawals()`, `getKycSubmissions()` — whose results were
 * serialised whole into the RSC payload so that the browser could derive six
 * counts with `filter`/`reduce` and slice five rows off each list. The KYC one
 * was three unbounded queries by itself, because attaching documents and notes
 * read every document and every note on the platform.
 *
 * Now: one aggregate statement for the six figures, and six small `LIMIT`ed
 * reads for the six panels. The payload stops growing with the platform.
 *
 * IT ALSO FIXES TWO PANELS THAT WERE ALWAYS EMPTY
 * -----------------------------------------------
 * `RecentInvestments` and `RecentSecurityEvents` read `investments` and
 * `securityEvents` from the admin store, and the dashboard page never provided
 * either. Unprovided slices fall back to `[]` (see `admin-store.tsx`), so both
 * panels rendered "nothing recent" regardless of what had happened — silently,
 * because an empty list is indistinguishable from an empty platform. They are
 * fetched here.
 *
 * One wave. Seven reads against a five-connection pool is two waves of round
 * trips rather than one, which is the honest cost of this change; it buys a
 * payload that no longer scales with the number of accounts, and it is why
 * each read is `LIMIT`ed rather than merely projected.
 */
export async function getAdminDashboard(): Promise<AdminDashboardData> {
  const [metrics, users, deposits, withdrawals, kyc, investments, securityEvents] =
    await Promise.all([
      fromDatabase(readDashboardMetrics, () => seedDashboardMetrics()),
      fromDatabase(
        (db) => listRecentUsers(db, RECENT_PANEL_ROWS),
        () => seedUsers.slice(0, RECENT_PANEL_ROWS),
      ),
      fromDatabase(
        (db) => listAdminDeposits(db, { limit: RECENT_PANEL_ROWS }),
        () => seedDeposits.slice(0, RECENT_PANEL_ROWS),
      ),
      fromDatabase(
        (db) => listAdminWithdrawals(db, { limit: RECENT_PANEL_ROWS }),
        () => seedWithdrawals.slice(0, RECENT_PANEL_ROWS),
      ),
      fromDatabase(
        (db) => listKycSubmissions(db, { limit: RECENT_PANEL_ROWS }),
        () => seedKycSubmissions.slice(0, RECENT_PANEL_ROWS),
      ),
      fromDatabase(
        (db) => listAdminInvestments(db, { limit: RECENT_PANEL_ROWS }),
        () => seedInvestments.slice(0, RECENT_PANEL_ROWS),
      ),
      fromDatabase(
        (db) => listUserSecurityEvents(db, { limit: RECENT_SECURITY_ROWS }),
        () => seedSecurityEvents.slice(0, RECENT_SECURITY_ROWS),
      ),
    ]);

  return { metrics, users, deposits, withdrawals, kyc, investments, securityEvents };
}

/**
 * The same six figures, derived from the seed modules when no database is
 * configured.
 *
 * Counted from the fixtures rather than invented, so the no-database mode
 * shows numbers that match the lists beside them — which is the whole point of
 * the fallback (CLAUDE.md §16.3).
 */
function seedDashboardMetrics(): AdminDashboardMetrics {
  const depositsPending = seedDeposits.filter((deposit) =>
    ["pending", "detected", "confirming", "confirmed"].includes(deposit.status),
  );
  const withdrawalsPending = seedWithdrawals.filter((withdrawal) =>
    ["pending", "under_review", "approved", "processing"].includes(withdrawal.status),
  );

  return {
    kycPending: seedKycSubmissions.filter((submission) =>
      ["pending", "under_review"].includes(submission.status),
    ).length,
    depositsPending: depositsPending.length,
    depositsPendingUsdt: depositsPending.reduce((sum, d) => sum + d.amountUsdt, 0),
    withdrawalsPending: withdrawalsPending.length,
    withdrawalsPendingUsdt: withdrawalsPending.reduce(
      (sum, w) => sum + w.amountUsdt,
      0,
    ),
    usersRestricted: seedUsers.filter((user) =>
      ["blocked", "suspended"].includes(user.status),
    ).length,
  };
}
