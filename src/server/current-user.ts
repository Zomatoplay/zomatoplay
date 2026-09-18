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

/**
 * For **page renders only**: no session sends the visitor to sign in.
 *
 * WHY THIS EXISTS SEPARATELY FROM `requireCurrentUserId`
 * ------------------------------------------------------
 * Next renders a layout and the page beneath it **in parallel**. The gate in
 * `(app)/layout.tsx` calls `redirect()` when there is no session, but that does
 * not stop the page: it runs anyway, calls a read, and throws.
 *
 * That is the reported `NotAuthenticatedError … at getUserSlices … at HomePage`
 * — an *expected* authentication outcome surfacing as an application failure.
 * The visitor still got their redirect, because the layout's won the response,
 * but the page had already executed authenticated queries and logged a server
 * error. It was also a race: which of the two wins is not guaranteed.
 *
 * `redirect()` throws a signal Next understands, so the page stops cleanly with
 * no error, no query and no log noise.
 *
 * **Server actions must not use this.** An action that redirects instead of
 * returning `{ ok: false }` gives its caller no way to show a message, and a
 * `fetch`-invoked action would follow the redirect and look like success.
 * Actions keep `requireCurrentUserId`, which throws and is caught.
 */
export async function requireCurrentUserIdForPage(): Promise<string> {
  const userId = await getCurrentUserId();
  if (userId) return userId;

  /*
   * Imported here rather than at module scope.
   *
   * `next/navigation` pulls in React's context machinery, and this module is
   * imported by the integration tests, which run as plain Node under
   * `--conditions=react-server`. A top-level import broke two whole test files
   * with `React.createContext is not a function` — a build-time coupling that
   * has no business existing for a function most callers never reach.
   */
  const { redirect } = await import("next/navigation");
  // `redirect` never returns — it throws Next's control-flow signal — but its
  // declared type does not say so once it is behind a dynamic import.
  redirect("/login");
  throw new NotAuthenticatedError();
}

/** Resolves an explicit id, or falls back to the session. Never to a demo. */
export async function resolveUserId(userId?: string): Promise<string> {
  return userId ?? requireCurrentUserId();
}

/**
 * The same, for reads that only ever run during a **page render**.
 *
 * WHY BOTH EXIST, AND WHY PICKING THE WRONG ONE IS A VISIBLE FAULT
 * ----------------------------------------------------------------
 * `requireCurrentUserIdForPage` above explains that the layout's gate does not
 * stop the page beneath it: Next renders the two in parallel, so an
 * unauthenticated request executes both, and whichever settles first decides
 * what the visitor gets. `getUserSlices` was moved onto the redirecting
 * resolver for exactly that reason — but its *siblings* in the same
 * `Promise.all` were left on `resolveUserId`, which throws.
 *
 * `Promise.all` rejects with whichever promise rejects first, so on every
 * primary screen the clean redirect and a bare `NotAuthenticatedError` were
 * racing, and the error won often enough to be reported from
 * `.next/server/app/(app)/page.js`. On `/settings/support` and
 * `/settings/wallet`, which read nothing through `getUserSlices` at all, there
 * was no race to lose: the throw was the only outcome.
 *
 * So the rule is about the *call site*, not the service: a read reached only
 * from a server component uses this one and an absent session ends as a
 * redirect. **A server action must keep `resolveUserId`** — an action that
 * redirects gives its caller no way to show a message, and a `fetch`-invoked
 * action would follow the redirect and read as success.
 */
export async function resolveUserIdForPage(userId?: string): Promise<string> {
  return userId ?? requireCurrentUserIdForPage();
}
