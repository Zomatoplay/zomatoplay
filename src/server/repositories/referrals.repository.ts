import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { CommissionEntry, Referral, ReferralSummary, VipLevel } from "@/types";
import type {
  AdminCommissionEntry,
  AdminListQuery,
  AdminReferralAccount,
  AdminReferralsSummary,
  PagedResult,
} from "@/types/admin";

import { likePattern, pageTotal, readPage } from "./paginate";
import {
  toAdminCommissionEntry,
  toAdminReferralAccount,
  toCommissionEntry,
  toReferral,
} from "./mappers";

/** The referral programme: who introduced whom, and what it paid. */

export async function listReferralsForUser(
  db: Database,
  userId: string,
): Promise<Referral[]> {
  const rows = await db
    .select()
    .from(schema.referrals)
    .where(eq(schema.referrals.referrerUserId, userId))
    .orderBy(desc(schema.referrals.joinedAt));
  return rows.map(toReferral);
}

export async function listCommissionsForUser(
  db: Database,
  userId: string,
): Promise<CommissionEntry[]> {
  const rows = await db
    .select()
    .from(schema.commissionEntries)
    .where(eq(schema.commissionEntries.beneficiaryUserId, userId))
    .orderBy(desc(schema.commissionEntries.createdAt));
  return rows.map(toCommissionEntry);
}

/**
 * The user's referral standing.
 *
 * `nextLevelProgress` is computed here rather than stored, because it is a
 * function of the account's totals and the VIP thresholds — two things that
 * each change on their own schedule, and a stored percentage would go stale
 * the moment either did.
 */
export async function findReferralSummary(
  db: Database,
  userId: string,
  vipLevels: VipLevel[],
): Promise<ReferralSummary | null> {
  const [row] = await db
    .select({ account: schema.referralAccounts, user: schema.users })
    .from(schema.referralAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.referralAccounts.userId))
    .where(eq(schema.referralAccounts.userId, userId))
    .limit(1);

  if (!row) return null;
  const { account, user } = row;

  return {
    totalReferrals: account.directReferrals + account.indirectReferrals,
    activeReferrals: account.activeReferrals,
    totalEarnings: account.commissionEarnedUsdt,
    pendingEarnings: account.commissionPendingUsdt,
    teamVolume: account.teamVolumeUsdt,
    currentLevel: user.vipLevel,
    nextLevelProgress: progressToNextLevel(
      vipLevels,
      user.vipLevel,
      account.activeReferrals,
      account.teamVolumeUsdt,
    ),
  };
}

/**
 * How far the account is toward the next VIP level, 0–100, or null at the top.
 *
 * Both requirements have to be met, so progress is the lesser of the two — the
 * one still holding the account back is the honest number to show.
 */
function progressToNextLevel(
  levels: VipLevel[],
  currentLevel: string,
  activeReferrals: number,
  teamVolume: number,
): number | null {
  const index = levels.findIndex((level) => level.id === currentLevel);
  const next = index >= 0 ? levels[index + 1] : undefined;
  if (!next) return null;

  const byReferrals =
    next.requirements.activeReferrals === 0
      ? 1
      : activeReferrals / next.requirements.activeReferrals;
  const byVolume =
    next.requirements.teamVolumeUsdt === 0
      ? 1
      : teamVolume / next.requirements.teamVolumeUsdt;

  return Math.min(100, Math.round(Math.min(byReferrals, byVolume) * 100));
}

/* -------------------------------------------------------------------------- */
/* Master CRM                                                                  */
/* -------------------------------------------------------------------------- */

export async function listAdminReferralAccounts(
  db: Database,
): Promise<AdminReferralAccount[]> {
  const rows = await db
    .select({ account: schema.referralAccounts, user: schema.users })
    .from(schema.referralAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.referralAccounts.userId))
    .orderBy(desc(schema.referralAccounts.commissionEarnedUsdt));

  return rows.map(({ account, user }) => toAdminReferralAccount(account, user));
}

export async function listAdminCommissionLedger(
  db: Database,
): Promise<AdminCommissionEntry[]> {
  const rows = await db
    .select({ entry: schema.commissionEntries, beneficiary: schema.users })
    .from(schema.commissionEntries)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.commissionEntries.beneficiaryUserId),
    )
    .orderBy(desc(schema.commissionEntries.createdAt));

  return rows.map(({ entry, beneficiary }) =>
    toAdminCommissionEntry(entry, beneficiary.fullName),
  );
}

/**
 * Whether an invite code names a real account that may refer people.
 *
 * Returns only a boolean-ish shape — the owner's id and nothing else. A signup
 * form must be able to tell somebody their code was mistyped, and it must not
 * become a way to read who owns it: no name, no email, no display id crosses
 * this boundary.
 *
 * `status` is checked as well as existence. A blocked or deactivated account
 * should not be accruing a team while it is shut out of the product, and an
 * attribution made to one is a commission relationship nobody can act on.
 */
export async function findReferrerByCode(
  db: Database,
  code: string,
): Promise<{ userId: string } | null> {
  const [row] = await db
    .select({ userId: schema.users.id })
    .from(schema.users)
    .where(
      and(
        eq(schema.users.referralCode, code),
        eq(schema.users.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Ordered by the catalogue's own sequence, not by name. */
export async function listVipLevelsOrdered(db: Database) {
  return db.select().from(schema.vipLevels).orderBy(asc(schema.vipLevels.sortOrder));
}

/* -------------------------------------------------------------------------- */
/* The paginated referral screens                                              */
/* -------------------------------------------------------------------------- */

function referralPersonSearch(search: string) {
  if (!search) return undefined;
  const pattern = likePattern(search);
  return or(
    ilike(schema.users.fullName, pattern),
    ilike(schema.users.email, pattern),
    ilike(schema.users.displayId, pattern),
    ilike(schema.users.referralCode, pattern),
  );
}

const REFERRAL_ACCOUNT_SORTS = {
  earnings: () => desc(schema.referralAccounts.commissionEarnedUsdt),
  referrals: () => desc(schema.referralAccounts.activeReferrals),
  recent: () => desc(schema.referralAccounts.joinedAt),
} as const;

/**
 * One page of referral accounts.
 *
 * `status` is the VIP level here rather than a lifecycle state — it is the one
 * dimension this table is triaged by, and reusing the `status` slot keeps it
 * on the same chips every other list screen uses.
 */
export async function pageAdminReferralAccounts(
  db: Database,
  query: AdminListQuery,
): Promise<PagedResult<AdminReferralAccount>> {
  const where = and(
    query.status === "all"
      ? undefined
      : eq(
          schema.users.vipLevel,
          query.status as (typeof schema.users.vipLevel.enumValues)[number],
        ),
    referralPersonSearch(query.search),
  );

  return readPage(query, async (page) => {
    const rows = await db
      .select({
        account: schema.referralAccounts,
        user: schema.users,
        total: pageTotal,
      })
      .from(schema.referralAccounts)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.referralAccounts.userId),
      )
      .where(where)
      .orderBy(
        REFERRAL_ACCOUNT_SORTS[
          query.sort as keyof typeof REFERRAL_ACCOUNT_SORTS
        ](),
      )
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);

    return {
      rows: rows.map(({ account, user }) =>
        toAdminReferralAccount(account, user),
      ),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

export async function countReferralAccountsByVip(
  db: Database,
  query: AdminListQuery,
): Promise<Record<string, number>> {
  const rows = await db
    .select({ level: schema.users.vipLevel, count: sql<number>`count(*)::int` })
    .from(schema.referralAccounts)
    .innerJoin(schema.users, eq(schema.users.id, schema.referralAccounts.userId))
    .where(referralPersonSearch(query.search))
    .groupBy(schema.users.vipLevel);

  const counts: Record<string, number> = { all: 0 };
  for (const row of rows) {
    counts[row.level] = Number(row.count);
    counts.all += Number(row.count);
  }
  return counts;
}

const COMMISSION_SORTS = {
  recent: () => desc(schema.commissionEntries.createdAt),
  oldest: () => asc(schema.commissionEntries.createdAt),
  amount: () => desc(schema.commissionEntries.amountUsdt),
} as const;

/** One page of the commission ledger — the fastest-growing table here. */
export async function pageAdminCommissionLedger(
  db: Database,
  query: AdminListQuery,
): Promise<PagedResult<AdminCommissionEntry>> {
  const where = and(
    query.status === "all"
      ? undefined
      : eq(
          schema.commissionEntries.status,
          query.status as (typeof schema.commissionEntries.status.enumValues)[number],
        ),
    referralPersonSearch(query.search),
  );

  return readPage(query, async (page) => {
    const rows = await db
      .select({
        entry: schema.commissionEntries,
        beneficiary: schema.users,
        total: pageTotal,
      })
      .from(schema.commissionEntries)
      .innerJoin(
        schema.users,
        eq(schema.users.id, schema.commissionEntries.beneficiaryUserId),
      )
      .where(where)
      .orderBy(COMMISSION_SORTS[query.sort as keyof typeof COMMISSION_SORTS]())
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);

    return {
      rows: rows.map(({ entry, beneficiary }) =>
        toAdminCommissionEntry(entry, beneficiary.fullName),
      ),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

export async function countCommissionsByStatus(
  db: Database,
  query: AdminListQuery,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: schema.commissionEntries.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.commissionEntries)
    .innerJoin(
      schema.users,
      eq(schema.users.id, schema.commissionEntries.beneficiaryUserId),
    )
    .where(referralPersonSearch(query.search))
    .groupBy(schema.commissionEntries.status);

  const counts: Record<string, number> = { all: 0 };
  for (const row of rows) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }
  return counts;
}

/**
 * The referral screen's three figures. Display aggregates only — see
 * `readDepositsSummary` in the ledger repository for why `float8` is fine
 * here and nowhere that moves money.
 */
export async function readReferralsSummary(
  db: Database,
): Promise<AdminReferralsSummary> {
  const [commission, volume] = await Promise.all([
    db.execute<{ credited: number; pending: number }>(sql`
      select
        coalesce(sum(${schema.commissionEntries.amountUsdt})
          filter (where ${schema.commissionEntries.status} = 'credited'), 0)::float8 as credited,
        coalesce(sum(${schema.commissionEntries.amountUsdt})
          filter (where ${schema.commissionEntries.status} = 'pending'), 0)::float8 as pending
      from ${schema.commissionEntries}
    `),
    db.execute<{ team_volume: number }>(sql`
      select coalesce(sum(${schema.referralAccounts.teamVolumeUsdt}), 0)::float8 as team_volume
      from ${schema.referralAccounts}
    `),
  ]);

  return {
    creditedCommissionUsdt: Number(commission[0]?.credited ?? 0),
    pendingCommissionUsdt: Number(commission[0]?.pending ?? 0),
    totalTeamVolumeUsdt: Number(volume[0]?.team_volume ?? 0),
  };
}
