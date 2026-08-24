import "server-only";

import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";

import { getDb, isDatabaseConfigured } from "@/db";
import { resilientRead } from "../database";
import type {
  AppNotification,
  BankAccount,
  Investment,
  NotificationPreference,
  SavedWalletAddress,
  SecurityActivity,
  SupportTicket,
  Transaction,
  UserProfile,
  WalletBalance,
} from "@/types";

import { requireCurrentUserIdForPage, resolveUserId } from "../current-user";
import {
  listNotificationPreferences,
  listNotificationsForUser,
} from "../repositories/engagement.repository";
import { listInvestmentsForUser } from "../repositories/investments.repository";
import { listTransactionsForUser } from "../repositories/ledger.repository";
import { toWalletBalance } from "../repositories/mappers";
import {
  findUserProfile,
  findWalletBalance,
  listBankAccounts,
  listSecurityActivity,
  listSupportTickets,
  listWalletAddresses,
} from "../repositories/users.repository";

/**
 * The signed-in account.
 *
 * NO FALLBACK, ON PURPOSE
 * -----------------------
 * These functions used to fall back to the seed modules in `@/data` when no
 * database was configured. That fallback is gone from every user-scoped read,
 * and its removal is the point rather than a side effect:
 *
 * - The seed data describes *one specific person*. Serving it to whoever is
 *   asking is showing them someone else's balance, allocations and
 *   verification status.
 * - A database outage must fail, visibly. A wallet that renders a plausible
 *   figure from mock data during an outage is worse than one that renders an
 *   error, because nobody goes looking for a problem they cannot see.
 *
 * Catalogue content — plans, networks, VIP tiers — still has a fallback. It is
 * the same for everyone and belongs to nobody.
 */

export class AccountUnavailableError extends Error {
  constructor(message = "The account store is unavailable.") {
    super(message);
    this.name = "AccountUnavailableError";
  }
}

/**
 * Reads live account state. Opts the render out of static generation.
 *
 * WHY THIS GOES THROUGH `resilientRead`
 * -------------------------------------
 * It used to call `query(getDb())` directly — no deadline and no retry — while
 * `fromDatabase()` next door had both. That asymmetry was not cosmetic: these
 * are the *hottest* reads in the application (every wallet, balance, profile
 * and allocation screen), and they were the only ones with nothing bounding
 * them.
 *
 * Measured before the change: `auth.resolveAccount` failing after an average of
 * **55–71 seconds**, and page requests observed at 33s, 46s and 49s. The 15s
 * deadline was never reaching this path, so a single unhealthy pooler endpoint
 * turned into a request that hung until something upstream gave up.
 */
async function read<T>(query: (db: ReturnType<typeof getDb>) => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) {
    throw new AccountUnavailableError(
      "No DATABASE_URL is configured. Account data has no source, and the seed " +
        "modules are not one — they describe a single demo person.",
    );
  }
  noStore();
  return resilientRead(() => query(getDb()));
}

/**
 * Request-scoped memoisation, keyed on the resolved account id.
 *
 * WHY EACH READ IS SPLIT IN TWO
 * -----------------------------
 * The layout fetches the whole account seed, and then the page fetches some of
 * it again: Home read the profile twice, Referral twice, Wallet built the same
 * earnings rollup twice. Each duplicate was a real ~400ms round trip for a row
 * the request already had in memory.
 *
 * `cache()` is keyed on arguments, so `getUserProfile()` and
 * `getUserProfile(id)` would be two separate entries sharing nothing — which is
 * exactly how the duplicates arose. Every read therefore resolves the session
 * *first* and delegates to a cached function taking the concrete id, so both
 * call styles land on one entry.
 *
 * Request-scoped only: a later request re-reads, so nothing here can serve a
 * stale balance across requests.
 */
const cachedProfile = cache((id: string) => read((db) => findUserProfile(db, id)));
const cachedWallet = cache((id: string) => read((db) => findWalletBalance(db, id)));
const cachedBankAccounts = cache((id: string) =>
  read((db) => listBankAccounts(db, id)),
);
const cachedWalletAddresses = cache((id: string) =>
  read((db) => listWalletAddresses(db, id)),
);
const cachedSecurityActivity = cache((id: string) =>
  read((db) => listSecurityActivity(db, id)),
);
const cachedSupportTickets = cache((id: string) =>
  read((db) => listSupportTickets(db, id)),
);
const cachedInvestments = cache((id: string) =>
  read((db) => listInvestmentsForUser(db, id)),
);
const cachedTransactions = cache((id: string) =>
  read((db) => listTransactionsForUser(db, id)),
);
const cachedNotifications = cache((id: string) =>
  read((db) => listNotificationsForUser(db, id)),
);
const cachedNotificationPreferences = cache((id: string) =>
  read((db) => listNotificationPreferences(db, id)),
);

export async function getUserProfile(userId?: string): Promise<UserProfile> {
  const id = await resolveUserId(userId);
  const profile = await cachedProfile(id);
  if (!profile) throw new AccountUnavailableError("No profile for this account.");
  return profile;
}

export async function getWalletBalance(userId?: string): Promise<WalletBalance> {
  const id = await resolveUserId(userId);
  const wallet = await cachedWallet(id);
  // A missing wallet row is a zero balance, not an error: the row is created
  // with the account, and a race at first sign-in should not break the page.
  if (!wallet) {
    return {
      available: 0,
      totalDeposited: 0,
      totalInvested: 0,
      totalWithdrawn: 0,
      totalProfit: 0,
      lockedInInvestments: 0,
    };
  }
  return toWalletBalance(wallet);
}

export async function getBankAccounts(userId?: string): Promise<BankAccount[]> {
  const id = await resolveUserId(userId);
  return cachedBankAccounts(id);
}

export async function getSavedWalletAddresses(
  userId?: string,
): Promise<SavedWalletAddress[]> {
  const id = await resolveUserId(userId);
  return cachedWalletAddresses(id);
}

export async function getSecurityActivity(
  userId?: string,
): Promise<SecurityActivity[]> {
  const id = await resolveUserId(userId);
  return cachedSecurityActivity(id);
}

export async function getSupportTickets(userId?: string): Promise<SupportTicket[]> {
  const id = await resolveUserId(userId);
  return cachedSupportTickets(id);
}

export async function getInvestments(userId?: string): Promise<Investment[]> {
  const id = await resolveUserId(userId);
  return cachedInvestments(id);
}

export async function getTransactions(userId?: string): Promise<Transaction[]> {
  const id = await resolveUserId(userId);
  return cachedTransactions(id);
}

export async function getNotifications(userId?: string): Promise<AppNotification[]> {
  const id = await resolveUserId(userId);
  return cachedNotifications(id);
}

export async function getNotificationPreferences(
  userId?: string,
): Promise<NotificationPreference[]> {
  const id = await resolveUserId(userId);
  return cachedNotificationPreferences(id);
}

/**
 * WHAT THE LAYOUT READS: NOTHING.
 *
 * The route-group layout resolves the session — it has to, that is the gate —
 * and then renders. It fetches no account data at all, because **an await in a
 * layout gates every page beneath it**: the page's own reads cannot start until
 * the layout's have finished, turning one wave of round trips into two.
 *
 * That was measured, not assumed. Moving the six slices out of the layout but
 * leaving a single profile read behind made pages that need slices 8–19%
 * *slower* — the one query in the layout serialised everything after it — while
 * only `/settings/kyc`, which needs nothing, got faster. Removing the last
 * layout read is what made the split pay.
 *
 * WHAT THIS REPLACED, AND WHY
 * ---------------------------
 * `getUserAppSeed()` fetched six slices — profile, balance, allocations,
 * transactions, notifications and notification preferences — on *every*
 * navigation, including screens that used none of them. Measured: against a
 * five-connection pool that is two waves of round trips, and
 * `/settings/kyc`, which needs a single status field, cost 2,048ms.
 *
 * It is the same mistake the CRM had and for the same reason (§4.2): data read
 * in a layout is convenient to consume and expensive to justify. Pages read
 * their own slices now.
 */


/**
 * The slices a page can hand to the store.
 *
 * Every field optional: a page provides what it renders. Reading one a page did
 * not provide is a developer error and is raised as one — see the store.
 */
export interface UserSliceData {
  profile?: UserProfile;
  balance?: WalletBalance;
  investments?: Investment[];
  transactions?: Transaction[];
  notifications?: AppNotification[];
  notificationPreferences?: NotificationPreference[];
}

/**
 * Convenience for pages that need several slices at once.
 *
 * `Promise.all`, so the reads overlap rather than queue. The account id is
 * resolved once and passed down; every read below is memoised per request, so
 * a slice the layout already fetched costs nothing to ask for again.
 */
export type LoadedSlices<K extends keyof UserSliceData> = {
  [P in K]-?: NonNullable<UserSliceData[P]>;
};

export async function getUserSlices<K extends keyof UserSliceData>(
  keys: readonly K[],
  userId?: string,
): Promise<LoadedSlices<K>> {
  // Page-only, so a missing session redirects rather than throwing — see
  // `requireCurrentUserIdForPage`. Every `(app)` page reads through here.
  const id = userId ?? (await requireCurrentUserIdForPage());

  const loaders: { [P in keyof UserSliceData]-?: () => Promise<unknown> } = {
    profile: () => getUserProfile(id),
    balance: () => getWalletBalance(id),
    investments: () => getInvestments(id),
    transactions: () => getTransactions(id),
    notifications: () => getNotifications(id),
    notificationPreferences: () => getNotificationPreferences(id),
  };

  const entries = await Promise.all(
    keys.map(async (key) => [key, await loaders[key]()] as const),
  );

  // The keys were named by the caller, so what comes back is not optional —
  // which is what lets a page use `slices.profile` without a non-null
  // assertion, while the store's own type keeps every slice optional.
  return Object.fromEntries(entries) as LoadedSlices<K>;
}
