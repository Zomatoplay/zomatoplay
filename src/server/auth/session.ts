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

  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  const metadata = data.user.user_metadata as
    | { full_name?: unknown; name?: unknown }
    | null;
  const rawName = metadata?.full_name ?? metadata?.name;

  return {
    authUserId: data.user.id,
    email: data.user.email ?? null,
    emailConfirmedAt: data.user.email_confirmed_at ?? null,
    fullName: typeof rawName === "string" && rawName.trim() ? rawName.trim() : null,
  };
});

export async function signOut(): Promise<void> {
  if (!isAuthConfigured()) return;
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
