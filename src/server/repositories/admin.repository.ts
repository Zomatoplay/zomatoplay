import "server-only";

import { asc, desc, eq, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type {
  AdminAgent,
  AdminDashboardMetrics,
  AuditLogEntry,
  PlatformSettings,
} from "@/types/admin";

import { toAuditLogEntry, toPermissionSet, toPlatformSettings } from "./mappers";
import { maskIndianMobile } from "@/lib/phone";

/** Operators, the audit trail and platform configuration. */

/** One recorded change to a plan's profit rate, newest first. */
export interface PlanRateHistoryEntry {
  id: string;
  previousRatePercent: number | null;
  newRatePercent: number;
  effectiveAt: string;
  changedByLabel: string;
  reason: string | null;
}

/**
 * A plan's rate history — every change `updatePlanAction` has recorded,
 * newest first, plus the opening entry `createPlanAction` wrote.
 *
 * Read-only and append-only, like `audit_logs`: nothing in this codebase
 * updates or deletes a row here (CLAUDE.md §10a — see `db/schema/plans.ts`).
 */
export async function listPlanRateHistory(
  db: Database,
  planId: string,
): Promise<PlanRateHistoryEntry[]> {
  const rows = await db
    .select({
      id: schema.planRateHistory.id,
      previousRatePercent: schema.planRateHistory.previousRatePercent,
      newRatePercent: schema.planRateHistory.newRatePercent,
      effectiveAt: schema.planRateHistory.effectiveAt,
      changedByLabel: schema.planRateHistory.changedByLabel,
      reason: schema.planRateHistory.reason,
    })
    .from(schema.planRateHistory)
    .where(eq(schema.planRateHistory.planId, planId))
    .orderBy(desc(schema.planRateHistory.effectiveAt));

  return rows.map((row) => ({ ...row, effectiveAt: row.effectiveAt.toISOString() }));
}

/**
 * The permission ids, taken from the database enum rather than from
 * `@/constants/admin`.
 *
 * Same list — the two are pinned to each other by a type assertion in
 * `db/schema/enums.ts` — but that module also carries the CRM's navigation
 * icons, and a repository has no business pulling a UI dependency into the
 * server bundle to find out what a column can contain. The enum *is* what the
 * column can contain.
 */
const PERMISSION_IDS = schema.adminPermissionEnum.enumValues;

/**
 * The operator directory with each agent's grants.
 *
 * Permissions are fetched as one flat query and grouped, rather than a query
 * per agent: the agents screen renders the whole matrix at once.
 */
export async function listAdminAgents(db: Database): Promise<AdminAgent[]> {
  /*
   * One wave, not two.
   *
   * These were sequential — read the agents, then read every grant — with an
   * early return when there were no agents. The grants query does not depend on
   * the agents query (it reads the whole table either way), so awaiting them in
   * order bought nothing and cost a full ~200ms round trip on a read that the
   * console shell used to run on every admin page.
   *
   * The early return is gone with it. It saved one small query in a state that
   * cannot occur in a working deployment — an operator is reading this screen,
   * so there is at least one agent — and paid for that with a round trip in
   * every state that can.
   */
  const [agents, grants] = await Promise.all([
    db.select().from(schema.adminAgents).orderBy(asc(schema.adminAgents.createdAt)),
    db.select().from(schema.adminAgentPermissions),
  ]);
  if (agents.length === 0) return [];

  const grantsByAgent = new Map<string, typeof grants>();
  for (const grant of grants) {
    const bucket = grantsByAgent.get(grant.agentId) ?? [];
    bucket.push(grant);
    grantsByAgent.set(grant.agentId, bucket);
  }

  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    status: agent.status,
    createdAt: agent.createdAt.toISOString(),
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
    permissions: toPermissionSet(grantsByAgent.get(agent.id) ?? [], PERMISSION_IDS),
    note: agent.note ?? undefined,
    passwordResetRequestedAt:
      agent.passwordResetRequestedAt?.toISOString() ?? null,
    // Masked here, server-side: the full number never reaches the browser.
    phoneMasked: agent.phoneE164 ? maskIndianMobile(agent.phoneE164) : null,
    phoneVerified: Boolean(agent.firebaseUid),
  }));
}

/**
 * The audit trail, newest first.
 *
 * Read-only by design: nothing in this repository updates or deletes an entry,
 * and nothing should be added that does.
 */
export async function listAuditLog(
  db: Database,
  limit = 500,
): Promise<AuditLogEntry[]> {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
  return rows.map(toAuditLogEntry);
}

/** Platform configuration. One row, `id = 'default'`. */
export async function findPlatformSettings(
  db: Database,
): Promise<PlatformSettings | null> {
  const [row] = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, "default"))
    .limit(1);
  return row ? toPlatformSettings(row) : null;
}

/* -------------------------------------------------------------------------- */
/* The CRM dashboard                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The six numbers on the dashboard's "needs attention" row.
 *
 * WHY THIS EXISTS: THE DASHBOARD USED TO READ THE WHOLE PLATFORM
 * --------------------------------------------------------------
 * `/admin` fetched every user, every deposit, every withdrawal and every KYC
 * case — four unbounded `select *` reads with joins — serialised all four into
 * the RSC payload, and then derived these six figures in the browser with
 * `Array.filter` and `Array.reduce`. `listKycSubmissions` alone is three
 * unbounded queries, because it also reads every document and every note on
 * the platform to attach them.
 *
 * At 36 accounts that is invisible. At 10,000 accounts with a year of
 * deposits it is the entire database, over the wire, on every dashboard view —
 * and the counts are the only thing most of it was fetched for.
 *
 * Six scalar subqueries in **one statement**, so the whole row costs one round
 * trip (~200 ms on this deployment) and transfers six numbers.
 *
 * THE MONEY FIGURES ARE DISPLAY AGGREGATES, AND THAT IS DELIBERATE
 * ----------------------------------------------------------------
 * `::float8` converts once, at the end, after Postgres has summed the
 * `numeric` column exactly. The code this replaces summed JavaScript floats
 * one row at a time, so this is strictly *more* accurate, not less. Nothing
 * here is an accounting figure — these are "how much is in flight" indicators
 * beside a queue count, and no balance, ledger entry or payout is derived from
 * them. Money that decides anything still goes through `@/db/money`.
 */
export async function readDashboardMetrics(
  db: Database,
): Promise<AdminDashboardMetrics> {
  /*
   * The status sets are the ones the dashboard has always used, moved from
   * four client-side `filter` predicates into SQL unchanged. They are written
   * out rather than derived from the enums on purpose: "which statuses count
   * as needing attention" is a product decision, and enumerating it here means
   * adding a status to the schema cannot silently change what an operator is
   * told is outstanding.
   *
   * One statement of scalar subqueries, issued through `db.execute` — the form
   * this codebase already uses for a statement that selects from no table.
   * Every count is served by an existing index (`kyc_submissions_status_idx`,
   * `deposits_status_idx`, `withdrawals_status_idx`, `users_status_idx`); none
   * of them was added for this.
   */
  const rows = await db.execute<{
    kyc_pending: number;
    deposits_pending: number;
    deposits_pending_usdt: number;
    withdrawals_pending: number;
    withdrawals_pending_usdt: number;
    users_restricted: number;
  }>(sql`
    select
      (select count(*)::int from ${schema.kycSubmissions}
        where ${schema.kycSubmissions.status} in ('pending', 'under_review'))
        as kyc_pending,
      (select count(*)::int from ${schema.deposits}
        where ${schema.deposits.status} in ('pending', 'detected', 'confirming', 'confirmed'))
        as deposits_pending,
      (select coalesce(sum(${schema.deposits.amountUsdt}), 0)::float8 from ${schema.deposits}
        where ${schema.deposits.status} in ('pending', 'detected', 'confirming', 'confirmed'))
        as deposits_pending_usdt,
      (select count(*)::int from ${schema.withdrawals}
        where ${schema.withdrawals.status} in ('pending', 'under_review', 'approved', 'processing'))
        as withdrawals_pending,
      (select coalesce(sum(${schema.withdrawals.amountUsdt}), 0)::float8 from ${schema.withdrawals}
        where ${schema.withdrawals.status} in ('pending', 'under_review', 'approved', 'processing'))
        as withdrawals_pending_usdt,
      (select count(*)::int from ${schema.users}
        where ${schema.users.status} in ('blocked', 'suspended'))
        as users_restricted
  `);

  const row = rows[0];
  if (!row) {
    // Unreachable — the statement selects from no table and always returns one
    // row — but a dashboard that renders zeros beats one that throws.
    return {
      kycPending: 0,
      depositsPending: 0,
      depositsPendingUsdt: 0,
      withdrawalsPending: 0,
      withdrawalsPendingUsdt: 0,
      usersRestricted: 0,
    };
  }

  return {
    kycPending: Number(row.kyc_pending),
    depositsPending: Number(row.deposits_pending),
    depositsPendingUsdt: Number(row.deposits_pending_usdt),
    withdrawalsPending: Number(row.withdrawals_pending),
    withdrawalsPendingUsdt: Number(row.withdrawals_pending_usdt),
    usersRestricted: Number(row.users_restricted),
  };
}
