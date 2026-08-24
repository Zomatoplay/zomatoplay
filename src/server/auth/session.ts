import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { isAuthConfigured, requireSupabaseConfig } from "@/lib/supabase/env";
import { trackPipeline } from "@/server/observability";

/**
 * The Supabase session, read server-side.
 *
 * WHY `getUser()` AND NOT `getSession()`
 * --------------------------------------
 * `getSession()` decodes the JWT sitting in the cookie and returns whatever it
 * says. The cookie is attacker-controlled data — anyone can put a JWT in it —
 * so trusting its contents is trusting the client. `getUser()` verifies the
 * token against Supabase before returning a principal.
 *
 * That verification is a network call, which is the cost of the guarantee. It
 * is the only correct choice for anything that gates access to money.
 */
export async function createSupabaseServerClient() {
  const { url, anonKey } = requireSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session instead, so this is safe to
          // ignore — it is the documented Supabase SSR pattern.
        }
      },
    },
  });
}

export interface AuthPrincipal {
  /** `auth.users.id`. */
  authUserId: string;
  email: string | null;
  /** When Supabase recorded proof of control of the mailbox. Null until then. */
  emailConfirmedAt: string | null;
  /**
   * What sign-up put in `options.data`. Only ever used to pre-fill a profile —
   * it is client-supplied text that happens to be carried by Supabase, so it is
   * never trusted for anything that grants access.
   */
  fullName: string | null;
}

/**
 * The verified principal, or null.
 *
 * Null means "not signed in" and nothing else. It never means "fall back to a
 * demo account" — see `getCurrentUserId` in `@/server/current-user`.
 *
 * MEMOISED PER REQUEST, AND THIS IS THE IMPORTANT PART
 * ----------------------------------------------------
 * `getUser()` is a **network call to Supabase** — it verifies the token rather
 * than decoding the cookie, which is the whole reason it is used (§19.4). One
 * costs ~240ms from here.
 *
 * It used to run once per caller. A page that read three services resolved the
 * same session three times, each time paying for the same verification of the
 * same cookie: measured at 2.0–3.7s per user page, most of it this.
 *
 * `cache()` from React memoises for the lifetime of a single request, so the
 * verification happens once and every later caller in that render gets the
 * result for free. It is *not* a cache across requests — a different request
 * has a different cookie and verifies again — so nothing about the security
 * property changes. The token is still verified against Supabase on every
 * request that needs it; it is verified once instead of five times.
 */
export async function getAuthPrincipal(): Promise<AuthPrincipal | null> {
  /*
   * Timed here, memoised below — and the order matters.
   *
   * React's `cache()` runs the wrapped function in its own async context, so
   * anything recorded *inside* it loses the request's `AsyncLocalStorage`
   * trace: the events landed under fresh correlation ids and each became its
   * own immediate insert. Wrapping the timing around the cached call keeps it
   * in the caller's context.
   *
   * A cache hit therefore records ~0ms, which is not noise — it is the
   * memoisation visibly working.
   */
  return trackPipeline(
    {
      pipeline: "auth",
      layer: "external",
      operation: "auth.resolvePrincipal",
      message: "Resolving the Supabase session",
    },
    () => loadPrincipal(),
  );
}

const loadPrincipal = cache(async function loadPrincipal(): Promise<AuthPrincipal | null> {
  if (!isAuthConfigured()) return null;

  let supabase;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    // No request scope, so no cookies, so no session. This happens when a
    // server module is exercised outside a request (a script, a test). It is
    // "nobody is signed in", which is exactly what null means — and the one
    // thing it must never become is a fallback to some default account.
    return null;
  }

  /*
   * VERIFIED LOCALLY, NOT BY A ROUND TRIP — AND STILL VERIFIED
   * ----------------------------------------------------------
   * This was `getUser()`, which asks Supabase to validate the token. Measured
   * from here: **385ms median, on every authenticated request**, and it was the
   * single largest cost in a navigation — larger than every database query on
   * the page combined.
   *
   * `getClaims()` verifies the JWT's signature against the project's published
   * JWKS. This project signs with **ES256** (confirmed against
   * `/auth/v1/.well-known/jwks.json`), so verification is asymmetric and
   * happens in-process: measured 370ms for the first call, which fetches and
   * caches the key set, then **1–3ms** for every call after it.
   *
   * This is emphatically *not* the `getSession()` mistake that §19.4 forbids.
   * `getSession()` decodes an attacker-controlled cookie and believes it.
   * `getClaims()` checks a cryptographic signature the attacker cannot forge
   * without the project's private key, and rejects anything expired. If the
   * project is ever switched back to a legacy symmetric (HS256) secret, the
   * SDK cannot verify locally and falls back to a network `getUser()` call on
   * its own — so this is correct either way, just slower in that case.
   *
   * What is genuinely given up: a token revoked *server-side* stays valid until
   * it expires. That costs nothing here, because this deployment cannot revoke
   * server-side at all — it holds no service-role key, which §20.3 already
   * states plainly.
   */
  const { data, error } = await supabase.auth.getClaims();

  /*
   * AN OUTAGE IS NOT A SIGN-OUT — THIS IS THE `NotAuthenticatedError` BUG
   * ---------------------------------------------------------------------
   * This function used to `return null` on *any* error. Null means exactly one
   * thing to every caller: "nobody is signed in". So a transient failure to
   * reach Supabase — measured at up to 30.9s before it gave up — was reported
   * as an absent session, and a perfectly valid signed-in user was redirected
   * to `/login` or met `NotAuthenticatedError: Not signed in.` mid-navigation.
   * That is the reported symptom, and it was a lie told by an error path.
   *
   * A provider outage now throws something that says so, so the layout can show
   * a recoverable "try again" instead of destroying a good session. An invalid,
   * expired or absent token still returns null, because that really is "not
   * signed in".
   */
  if (error) {
    if (isProviderOutage(error)) {
      throw new AuthProviderUnavailableError(error.message);
    }
    return null;
  }

  const claims = data?.claims;
  if (!claims?.sub) return null;

  const metadata = claims.user_metadata as
    | { full_name?: unknown; name?: unknown }
    | null;
  const rawName = metadata?.full_name ?? metadata?.name;

  return {
    authUserId: claims.sub,
    email: claims.email ?? null,
    /*
     * The token carries `email_verified` as a boolean; `getUser()` returned a
     * timestamp. Nothing in the codebase currently reads this field, so the
     * shape is preserved rather than the value: a sentinel keeps the interface
     * honest about what is actually known, where inventing a plausible-looking
     * instant would be a fabricated timestamp waiting to be displayed. If a
     * caller ever needs the real confirmation time, it must come from a
     * `getUser()` call made deliberately for that purpose.
     */
    emailConfirmedAt: claims.email_verified ? VERIFIED_SENTINEL : null,
    fullName: typeof rawName === "string" && rawName.trim() ? rawName.trim() : null,
  };
});

/**
 * A marker for "this mailbox is confirmed", when the exact instant is not in
 * the token. Never rendered — see the callers, which only test truthiness.
 */
const VERIFIED_SENTINEL = "verified";

/**
 * Told apart from "this token is bad", which is the whole point.
 *
 * Supabase's auth errors carry a status: a 4xx is a verdict about the token
 * (expired, malformed, revoked) and means not-signed-in; a 5xx, a missing
 * status, or a transport failure means we could not *reach* a verdict, which
 * is an outage. Anything that reads like a network failure is treated as an
 * outage regardless of status.
 */
export function isProviderOutage(error: { message?: string; status?: number }): boolean {
  const message = String(error?.message ?? "");

  // Checked BEFORE the status, deliberately. If the transport itself failed
  // there was no verdict to receive, whatever status happens to be attached —
  // and reading a transport failure as a rejected token is what signs a valid
  // user out during a blip.
  if (/fetch failed|network|ECONN|ETIMEDOUT|EAI_AGAIN|socket|timeout|aborted/i.test(message)) {
    return true;
  }

  // A 4xx is the provider telling us about the token: expired, malformed,
  // revoked. That is a real answer, and it means not-signed-in.
  const status = error?.status;
  if (typeof status === "number" && status >= 400 && status < 500) return false;
  // No status at all is not a verdict about the token, so it cannot be treated
  // as one. Failing closed here would sign valid users out during an outage.
  return typeof status !== "number" || status >= 500;
}

/**
 * The auth provider could not be reached, so whether this request carries a
 * valid session is **unknown**.
 *
 * Distinct from null on purpose. Null grants nothing and is the safe answer to
 * "who is this"; this says "ask again shortly" and must never be quietly
 * converted into null by a caller, because that conversion is precisely the bug
 * it exists to prevent.
 */
export class AuthProviderUnavailableError extends Error {
  constructor(message: string) {
    super(`The sign-in service is temporarily unreachable. ${message}`.trim());
    this.name = "AuthProviderUnavailableError";
  }
}

export async function signOut(): Promise<void> {
  if (!isAuthConfigured()) return;
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
