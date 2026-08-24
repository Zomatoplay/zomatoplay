import "server-only";

import { getAuthenticatedAccount } from "./auth/account";

/**
 * Who the request is acting as.
 *
 * THE RULE
 * --------
 * The identity comes from the verified Supabase session and from nowhere else.
 * There is no demo account, no fallback and no `?userId=` — a browser cannot
 * name the account it wants to be.
 *
 * This module used to return a fixed demo user, which meant every visitor saw
 * one person's wallet, investments and verification status. That is now a
 * `NotAuthenticatedError`, and callers either have a session or get nothing.
 *
 * A `userId` parameter still appears throughout the service layer. It is not a
 * hole: those services are `server-only`, and their callers are server
 * components and server actions that resolved the id here, or operator actions
 * that were permission-checked first. Nothing reachable from the browser passes
 * an id it chose.
 */

export class NotAuthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
    this.name = "NotAuthenticatedError";
  }
}

export class ProfileIncompleteError extends Error {
  constructor() {
    super("This account has not finished its profile yet.");
    this.name = "ProfileIncompleteError";
  }
}

/** The signed-in application user id, or null when there is no session. */
export async function getCurrentUserId(): Promise<string | null> {
  const account = await getAuthenticatedAccount();
  return account?.userId ?? null;
}

/** The signed-in application user id, or a refusal. */
export async function requireCurrentUserId(): Promise<string> {
  const userId = await getCurrentUserId();
  if (!userId) throw new NotAuthenticatedError();
  return userId;
}

/** Resolves an explicit id, or falls back to the session. Never to a demo. */
export async function resolveUserId(userId?: string): Promise<string> {
  return userId ?? requireCurrentUserId();
}
