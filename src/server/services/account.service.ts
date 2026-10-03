import "server-only";

import { findTicketForUser } from "../repositories/tickets.repository";

import { cache } from "react";

import { signAvatarUrl } from "@/server/storage/avatar-store";
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
  TicketDetail,
  Transaction,
  UserProfile,
  WalletBalance,
} from "@/types";

import {
  requireCurrentUserIdForPage,
  resolveUserId,
  resolveUserIdForPage,
} from "../current-user";
import {
  countUnreadNotifications,
  listNotificationPreferences,
  listNotificationsForUser,
} from "../repositories/engagement.repository";
import { listInvestmentsForUser } from "../repositories/investments.repository";
import { listTransactionsForUser } from "../repositories/ledger.repository";
import { toWalletBalance } from "../repositories/mappers";
import { findOwnKycCase, type OwnKycCase } from "../repositories/kyc.repository";
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
const cachedProfile = cache(async (id: string) => {
  const profile = await read((db) => findUserProfile(db, id));
  if (!profile) return profile;
  // The onboarding photo lives in private S3: shown through a short-lived
  // presigned link signed here (locally, no round trip). The key itself never
  // leaves the server.
  const { avatarStorageKey, ...rest } = profile;
  const signed = await signAvatarUrl(avatarStorageKey ?? null);
  return { ...rest, avatarUrl: signed ?? rest.avatarUrl };
});
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
const cachedTransactions = cache((id: string, limit: number) =>
  read((db) => listTransactionsForUser(db, id, { limit })),
);
const cachedNotifications = cache((id: string, limit: number) =>
  read((db) => listNotificationsForUser(db, id, { limit })),
);
const cachedUnreadNotificationCount = cache((id: string) =>
  read((db) => countUnreadNotifications(db, id)),
);
const cachedNotificationPreferences = cache((id: string) =>
  read((db) => listNotificationPreferences(db, id)),
);
const cachedOwnKycCase = cache((id: string) =>
  read((db) => findOwnKycCase(db, id)),
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
  const id = await resolveUserIdForPage(userId);
  return cachedBankAccounts(id);
}

export async function getSavedWalletAddresses(
  userId?: string,
): Promise<SavedWalletAddress[]> {
  const id = await resolveUserIdForPage(userId);
  return cachedWalletAddresses(id);
}

export async function getSecurityActivity(
  userId?: string,
): Promise<SecurityActivity[]> {
  const id = await resolveUserIdForPage(userId);
  return cachedSecurityActivity(id);
}

export async function getSupportTickets(userId?: string): Promise<SupportTicket[]> {
  const id = await resolveUserIdForPage(userId);
  return cachedSupportTickets(id);
}

/**
 * One of the signed-in customer's own tickets with its conversation, or null.
 * Page-render use: no session redirects to sign-in. The owner is the session's
 * account — the id in the URL only selects among that account's tickets.
 */
export async function getTicketDetail(ticketId: string): Promise<TicketDetail | null> {
  const id = await resolveUserIdForPage();
  return read((db) => findTicketForUser(db, id, ticketId));
}

export async function getInvestments(userId?: string): Promise<Investment[]> {
  const id = await resolveUserId(userId);
  return cachedInvestments(id);
}

/**
 * How many ledger entries a screen reads when it does not say otherwise.
 *
 * Home renders five and Wallet six, and both used to read an account's
 * **entire** history to do it — every row transferred from Postgres and
 * serialised into the RSC payload on every navigation, for five rows of
 * output. Fifty is far more than either renders and still leaves the Wallet
 * screen's type filters (deposits / withdrawals / investments / rewards /
 * referral) something real to select from, since they filter the fetched set
 * before slicing.
 *
 * It is a **default**, not a maximum, and that is the point: a screen added
 * later that forgets to think about this gets a bounded read rather than an
 * unbounded one.
 */
export const RECENT_TRANSACTIONS = 50;

/**
 * The ceiling for the screen that genuinely browses history.
 *
 * `/wallet/transactions` is the one place an account looks through its past,
 * so it asks for far more — but still asks. An unbounded read there is a page
 * that gets slower every month a person uses the product, and the honest
 * alternative to a limit is not "no limit", it is a limit the screen tells
 * the reader about. See the notice on that page.
 */
export const TRANSACTION_HISTORY_LIMIT = 250;

export async function getTransactions(
  userId?: string,
  limit: number = RECENT_TRANSACTIONS,
): Promise<Transaction[]> {
  const id = await resolveUserId(userId);
  // Memoised on `(id, limit)`, so two screens asking for different windows in
  // one render would be two reads. They never do — each page asks once — but
  // asking for the *same* window twice is free, which is the common case.
  return cachedTransactions(id, limit);
}

/**
 * How many notifications this account has to read.
 *
 * `TopBar` renders this on every primary section and used to derive it from
 * the full notification list — see `countUnreadNotifications`, which is the
 * indexed count that replaced the full read.
 */
export async function getUnreadNotificationCount(userId?: string): Promise<number> {
  const id = await resolveUserIdForPage(userId);
  return cachedUnreadNotificationCount(id);
}

/** The window `/settings/notifications` reads. Nothing else renders the list. */
export const NOTIFICATION_HISTORY_LIMIT = 100;

export async function getNotifications(
  userId?: string,
  limit: number = NOTIFICATION_HISTORY_LIMIT,
): Promise<AppNotification[]> {
  const id = await resolveUserId(userId);
  return cachedNotifications(id, limit);
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

export interface UserSliceOptions {
  /**
   * How far back the `transactions` slice reads. Defaults to
   * `RECENT_TRANSACTIONS`; only the history screen raises it.
   */
  transactionLimit?: number;
}

export async function getUserSlices<K extends keyof UserSliceData>(
  keys: readonly K[],
  userId?: string,
  options: UserSliceOptions = {},
): Promise<LoadedSlices<K>> {
  // Page-only, so a missing session redirects rather than throwing — see
  // `requireCurrentUserIdForPage`. Every `(app)` page reads through here.
  const id = userId ?? (await requireCurrentUserIdForPage());

  const loaders: { [P in keyof UserSliceData]-?: () => Promise<unknown> } = {
    profile: () => getUserProfile(id),
    balance: () => getWalletBalance(id),
    /*
     * `investments` is deliberately **not** limited.
     *
     * Every other list here is "the most recent N", which is a safe truncation
     * because what falls off the end is history. An allocation is not: a
     * fixed-term investment opened a year ago can still be `active`, and
     * ordering by `started_at` and taking the most recent N would silently
     * drop it from Home's "your investments" and from the totals beside it.
     * Hiding somebody's live allocation to save a round trip is not a trade
     * worth making. Allocations also accumulate far more slowly than ledger
     * entries — one per deliberate decision, against one per deposit, reward
     * and commission. If this ever needs bounding it must be by *status*, not
     * by recency.
     */
    investments: () => getInvestments(id),
    transactions: () => getTransactions(id, options.transactionLimit),
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

/**
 * The signed-in account's own verification case, or null before they submit.
 *
 * WHY THIS EXISTS
 * ---------------
 * `rejectKyc()` requires a reason and its comment says "the reason is what the
 * user is shown"; there is a test named "rejection stores the reason the user
 * is shown". Nothing showed it. The reason was written, reviewed, tested and
 * invisible — a rejected person saw a red badge and no way to find out what to
 * fix, which is the one thing a rejection has to communicate.
 *
 * Session-scoped like every other read here: the id comes from
 * `resolveUserId`, never from a caller, so this cannot be pointed at somebody
 * else's case.
 */
export async function getOwnKycCase(userId?: string): Promise<OwnKycCase | null> {
  const id = await resolveUserIdForPage(userId);
  return cachedOwnKycCase(id);
}
