import "server-only";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type {
  BankAccount,
  SavedWalletAddress,
  SecurityActivity,
  SupportTicket,
  UserProfile,
} from "@/types";
import type {
  AdminListQuery,
  AdminUser,
  AdminUserOption,
  PagedResult,
  UserDeviceSession,
  UserSecurityEvent,
} from "@/types/admin";

import { likePattern, pageTotal, readPage } from "./paginate";
import {
  toAdminUser,
  toBankAccount,
  toSavedWalletAddress,
  toSecurityActivity,
  toSupportTicket,
  toUserDeviceSession,
  toUserProfile,
  toUserSecurityEvent,
} from "./mappers";

/**
 * Accounts, wallets and everything hanging off an account.
 *
 * Repositories know about tables and nothing else: no fallback logic, no
 * `@/data` imports, no knowledge of which application is asking. The services
 * in `@/server/services` compose them and own the fallback.
 */

export async function findUserProfile(
  db: Database,
  userId: string,
): Promise<UserProfile | null> {
  /*
   * Both reads are keyed on the same `userId`, so the second never needed the
   * first's result — it was only waiting for it. Awaiting them in sequence cost
   * a whole extra round trip (~400ms from this deployment) on every screen that
   * shows a profile, which is all five primary sections: `TopBar` reads it.
   *
   * The steps for a user that turns out not to exist are always empty, so the
   * wasted query in that case costs nothing anybody waits for.
   */
  const [[user], steps] = await Promise.all([
    db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1),
    db
      .select()
      .from(schema.userKycSteps)
      .where(eq(schema.userKycSteps.userId, userId))
      .orderBy(asc(schema.userKycSteps.position)),
  ]);
  if (!user) return null;

  return toUserProfile(user, steps);
}

export async function findWalletBalance(db: Database, userId: string) {
  const [wallet] = await db
    .select()
    .from(schema.walletBalances)
    .where(eq(schema.walletBalances.userId, userId))
    .limit(1);
  return wallet ?? null;
}

export async function listBankAccounts(
  db: Database,
  userId: string,
): Promise<BankAccount[]> {
  const rows = await db
    .select()
    .from(schema.bankAccounts)
    .where(eq(schema.bankAccounts.userId, userId))
    .orderBy(desc(schema.bankAccounts.isDefault), asc(schema.bankAccounts.label));
  return rows.map(toBankAccount);
}

export async function listWalletAddresses(
  db: Database,
  userId: string,
): Promise<SavedWalletAddress[]> {
  const rows = await db
    .select()
    .from(schema.walletAddresses)
    .where(eq(schema.walletAddresses.userId, userId))
    .orderBy(
      desc(schema.walletAddresses.isDefault),
      asc(schema.walletAddresses.label),
    );
  return rows.map(toSavedWalletAddress);
}

/** The user's own view of their security history, newest first. */
export async function listSecurityActivity(
  db: Database,
  userId: string,
  limit = 20,
): Promise<SecurityActivity[]> {
  const rows = await db
    .select()
    .from(schema.userSecurityEvents)
    .where(eq(schema.userSecurityEvents.userId, userId))
    .orderBy(desc(schema.userSecurityEvents.createdAt))
    .limit(limit);
  return rows.map(toSecurityActivity);
}

export async function listSupportTickets(
  db: Database,
  userId: string,
): Promise<SupportTicket[]> {
  const rows = await db
    .select()
    .from(schema.supportTickets)
    .where(eq(schema.supportTickets.userId, userId))
    .orderBy(desc(schema.supportTickets.updatedAt));
  return rows.map(toSupportTicket);
}

/* -------------------------------------------------------------------------- */
/* Master CRM                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The full user directory with balances.
 *
 * A left join rather than a per-row lookup: the CRM's directory renders every
 * account's totals on the same screen, and the wallet is one row per user.
 */
export async function listAdminUsers(db: Database): Promise<AdminUser[]> {
  const rows = await db
    .select({ user: schema.users, wallet: schema.walletBalances })
    .from(schema.users)
    .leftJoin(
      schema.walletBalances,
      eq(schema.walletBalances.userId, schema.users.id),
    )
    .orderBy(asc(schema.users.registeredAt));

  return rows.map(({ user, wallet }) => toAdminUser(user, wallet));
}

/* -------------------------------------------------------------------------- */
/* The paginated directory                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Which `kyc_status` values each of the directory's KYC filters covers.
 *
 * Written out rather than derived from the enum, for the same reason the
 * dashboard's status sets are (see `readDashboardMetrics`): which states an
 * operator considers "pending" is a product decision, and deriving it would
 * let a new enum label silently change what a filter returns.
 */
const KYC_FILTER_STATUSES = {
  pending: ["not_started", "in_progress", "pending_review"],
  approved: ["verified"],
  rejected: ["rejected"],
} as const;

/** The columns the directory's search box matches, in one `OR`. */
function userSearchCondition(search: string) {
  if (!search) return undefined;
  const pattern = likePattern(search);
  return or(
    ilike(schema.users.fullName, pattern),
    ilike(schema.users.email, pattern),
    ilike(schema.users.id, pattern),
    ilike(schema.users.displayId, pattern),
    ilike(schema.users.phone, pattern),
    ilike(schema.users.walletAddress, pattern),
    ilike(schema.users.referralCode, pattern),
  );
}

/**
 * The directory's sorts, as an allowlist keyed by the token in the URL.
 *
 * A map rather than a string interpolated into `ORDER BY`: the token arrives
 * from a query parameter, and the set of orderings a screen offers is a
 * product decision, not something a caller gets to compose.
 */
const USER_SORTS = {
  recent: () => desc(schema.users.registeredAt),
  oldest: () => asc(schema.users.registeredAt),
  name: () => asc(schema.users.fullName),
  balance: () => desc(schema.walletBalances.available),
  active: () => desc(schema.users.lastActiveAt),
} as const;

export type UserSortToken = keyof typeof USER_SORTS;

/**
 * One page of the user directory, filtered, searched and sorted in Postgres.
 *
 * This replaces `listAdminUsers()` on the directory screen, which read every
 * account joined to every wallet and handed the lot to the browser so it could
 * `filter()` them and show ten. The predicates are the same ones the screen
 * always applied — moved, not changed.
 */
export async function pageAdminUsers(
  db: Database,
  query: AdminListQuery,
): Promise<PagedResult<AdminUser>> {
  const kycStatuses =
    KYC_FILTER_STATUSES[query.filter as keyof typeof KYC_FILTER_STATUSES];

  const where = and(
    query.status === "all"
      ? undefined
      : eq(
          schema.users.status,
          query.status as (typeof schema.users.status.enumValues)[number],
        ),
    kycStatuses ? inArray(schema.users.kycStatus, kycStatuses) : undefined,
    userSearchCondition(query.search),
  );

  return readPage(query, async (page) => {
    const rows = await db
      .select({
        user: schema.users,
        wallet: schema.walletBalances,
        total: pageTotal,
      })
      .from(schema.users)
      .leftJoin(
        schema.walletBalances,
        eq(schema.walletBalances.userId, schema.users.id),
      )
      .where(where)
      .orderBy(USER_SORTS[query.sort as UserSortToken]())
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);

    return {
      rows: rows.map(({ user, wallet }) => toAdminUser(user, wallet)),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

/**
 * How many accounts each status chip covers, under the *other* filters.
 *
 * The chips have always shown counts, and they are what an operator triages
 * by — "blocked 3" is the reason to click it. Server-side paging means the
 * browser no longer holds the rows to count, so the count comes from SQL.
 *
 * Deliberately a second statement rather than a window over the page query:
 * these counts must ignore the status filter (otherwise every chip but the
 * selected one reads zero) while the page query applies it, so they are two
 * different predicates over the same table. They are issued together in one
 * `Promise.all`, so the screen still costs one round trip of wall time — see
 * CLAUDE.md §16.1a on why the count of round trips is what matters and
 * parallelism up to the pool size is free.
 */
export async function countAdminUsersByStatus(
  db: Database,
  query: AdminListQuery,
): Promise<Record<string, number>> {
  const kycStatuses =
    KYC_FILTER_STATUSES[query.filter as keyof typeof KYC_FILTER_STATUSES];

  const rows = await db
    .select({
      status: schema.users.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.users)
    .where(
      and(
        kycStatuses ? inArray(schema.users.kycStatus, kycStatuses) : undefined,
        userSearchCondition(query.search),
      ),
    )
    .groupBy(schema.users.status);

  const counts: Record<string, number> = { all: 0 };
  for (const row of rows) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }
  return counts;
}

export async function listUserDeviceSessions(
  db: Database,
): Promise<UserDeviceSession[]> {
  const rows = await db
    .select()
    .from(schema.userDeviceSessions)
    .orderBy(desc(schema.userDeviceSessions.lastActiveAt));
  return rows.map(toUserDeviceSession);
}

export async function listUserSecurityEvents(
  db: Database,
  options: { limit?: number } = {},
): Promise<UserSecurityEvent[]> {
  /*
   * `limit` is optional because two callers want different things: the user
   * detail screen wants this account's whole history, and the dashboard panel
   * wants the six most recent events on the platform. Without it the panel was
   * reading every security event ever recorded to render six rows.
   */
  const query = db
    .select()
    .from(schema.userSecurityEvents)
    .orderBy(desc(schema.userSecurityEvents.createdAt));
  const rows = options.limit ? await query.limit(options.limit) : await query;
  return rows.map(toUserSecurityEvent);
}

/**
 * The most recently registered accounts, for the dashboard panel.
 *
 * A narrow projection and a `LIMIT`, where the panel used to be handed
 * `listAdminUsers()` — every account on the platform joined to every wallet,
 * sorted in the browser, sliced to five.
 */
export async function listRecentUsers(
  db: Database,
  limit: number,
): Promise<AdminUser[]> {
  const rows = await db
    .select({ user: schema.users, wallet: schema.walletBalances })
    .from(schema.users)
    .leftJoin(
      schema.walletBalances,
      eq(schema.walletBalances.userId, schema.users.id),
    )
    .orderBy(desc(schema.users.registeredAt))
    .limit(limit);

  return rows.map(({ user, wallet }) => toAdminUser(user, wallet));
}

/**
 * A short list of accounts matching a search, for an operator picker.
 *
 * The deposit attribution dialog used to receive the **entire** directory and
 * search it in the browser, showing at most eight matches — so the screen's
 * cost grew with the platform to render a dropdown. This asks Postgres the
 * same question and returns the same eight.
 *
 * Narrow on purpose: a picker needs a name, an email and a member id, not a
 * wallet balance. `limit` is a hard cap rather than a page — there is no
 * paging through a type-ahead, and an operator who cannot find an account in
 * eight results should type more of it.
 */
export async function searchUsersForPicker(
  db: Database,
  search: string,
  limit = 8,
): Promise<AdminUserOption[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      fullName: schema.users.fullName,
      email: schema.users.email,
      displayId: schema.users.displayId,
    })
    .from(schema.users)
    .where(userSearchCondition(search))
    .orderBy(asc(schema.users.fullName))
    .limit(limit);

  return rows;
}

/**
 * One account for the CRM detail screen.
 *
 * The screen used to be served by `listAdminUsers()` and a `find()` — every
 * account joined to every wallet, to render one. A `WHERE id = $1` against the
 * primary key does the same job in a fraction of the work, and stops the
 * detail screen getting slower every time somebody registers.
 */
export async function findAdminUserById(
  db: Database,
  id: string,
): Promise<AdminUser | null> {
  const [row] = await db
    .select({ user: schema.users, wallet: schema.walletBalances })
    .from(schema.users)
    .leftJoin(
      schema.walletBalances,
      eq(schema.walletBalances.userId, schema.users.id),
    )
    .where(eq(schema.users.id, id))
    .limit(1);

  return row ? toAdminUser(row.user, row.wallet) : null;
}
