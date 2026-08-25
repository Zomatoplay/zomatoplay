import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type {
  BankAccount,
  SavedWalletAddress,
  SecurityActivity,
  SupportTicket,
  UserProfile,
} from "@/types";
import type {
  AdminUser,
  UserDeviceSession,
  UserSecurityEvent,
} from "@/types/admin";

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
): Promise<UserSecurityEvent[]> {
  const rows = await db
    .select()
    .from(schema.userSecurityEvents)
    .orderBy(desc(schema.userSecurityEvents.createdAt));
  return rows.map(toUserSecurityEvent);
}
