import { Suspense } from "react";
import { redirect } from "next/navigation";

import { AppShell } from "@/components/navigation/app-shell";
import { SessionUnavailableNotice } from "@/components/shared/session-unavailable-notice";
import { PrototypeStoreProvider } from "@/lib/prototype-store";
import { getAuthenticatedAccount, isAccountLockedOut } from "@/server/auth/account";
import {
  AuthProviderUnavailableError,
  getAuthPrincipal,
} from "@/server/auth/session";
import { isInfrastructureFailure } from "@/server/errors";
import {
  describeError,
  errorDiagnostics,
  recordPipelineEvent,
} from "@/server/observability";
import { traceRender } from "@/server/trace-action";

/**
 * The user-facing application frame — and the gate in front of it.
 *
 * THE GATE
 * --------
 * Every route in this group is account data: a wallet, allocations, a
 * verification status, a referral standing. None of it exists without a
 * session, so the layout resolves one first and redirects to sign-in when there
 * is none.
 *
 * This is where the demo account used to be handed out. A visitor with no
 * session was silently given one specific person's finances to look at. There
 * is no fallback here now — no session means no data, and the sign-in page
 * says so.
 *
 * Server-side, and re-checked on every request. The middleware refreshes the
 * session cookie but decides nothing.
 */
/**
 * Never prerendered.
 *
 * Every route below this layout renders one account's data, so a build-time
 * copy would be somebody's wallet baked into a static file. Next cannot infer
 * that on its own: when Supabase is unconfigured the session check short-
 * circuits without reading cookies, so nothing marks the segment dynamic and
 * the build tries to prerender pages that then fail for want of a session.
 */
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return traceRender({ route: "(app)", actorType: "user" }, () =>
    renderAppLayout(children),
  );
}

/**
 * The half of the gate that needs the database, moved off the critical path.
 *
 * WHY THIS IS A SEPARATE, SUSPENDED COMPONENT
 * -------------------------------------------
 * The layout used to `await getAuthenticatedAccount()` before returning any
 * JSX at all. That is one `users` round trip — ~200ms warm, ~2,000ms on a cold
 * connection — during which **nothing** reached the browser: not the
 * navigation, not the page structure, not even a skeleton. `loading.tsx`
 * could not help, because a loading boundary wraps the segment *below* a
 * layout and is therefore downstream of the layout's own await.
 *
 * Measured on a production build with a real session: TTFB on the five
 * primary routes was 400–1,100ms, against a 20–45ms floor for a route that
 * reads nothing. Every one of those milliseconds was a blank screen.
 *
 * WHAT STAYS ON THE CRITICAL PATH, AND WHY THAT IS THE SECURITY-CRITICAL HALF
 * ---------------------------------------------------------------------------
 * `getAuthPrincipal()` stays above, awaited before anything renders. It is a
 * local ES256 signature check against a cached JWKS (1–3ms, no database), so
 * it costs nothing to keep — and keeping it is what preserves the guarantee in
 * CLAUDE.md §19.5: an unauthenticated visitor gets a real `307` to `/login`
 * and no application HTML whatsoever. That must not become a streamed
 * client-side redirect.
 *
 * WHAT MOVED, AND WHAT STILL ENFORCES IT
 * --------------------------------------
 * Only the checks that need the `users` row — lockout and profile-complete —
 * are deferred. They are **not** weakened: `requireCurrentUserIdForPage()`
 * now performs both, and every `(app)` page resolves its user through it. So
 * a blocked account cannot render a page's data even though the shell around
 * it has already been flushed. See the comment there.
 *
 * This component therefore adds no round trip of its own: the account read is
 * request-memoised, so it and the page beneath it share one query.
 */
async function AccountGate() {
  let account;
  try {
    account = await getAuthenticatedAccount();
  } catch (error) {
    /*
     * A database that cannot be reached is not an authorization verdict.
     *
     * The shell has already been flushed, so there is nothing to protect by
     * crashing here: no account was resolved, and every page below resolves
     * its own user through `requireCurrentUserIdForPage()`, which fails for
     * the same reason and surfaces through `(app)/error.tsx` — inside this
     * shell, with a retry, and without signing anybody out.
     *
     * Recorded rather than swallowed, because a gate that cannot reach the
     * database is exactly the fault that erases its own evidence
     * (CLAUDE.md §22.1a).
     */
    if (isInfrastructureFailure(error)) {
      recordPipelineEvent({
        pipeline: "auth",
        operation: "auth.gate.degraded",
        status: "failed",
        message: "The account gate could not reach the database; shell rendered",
        errorMessage: describeError(error),
        metadata: errorDiagnostics(error),
      });
      return null;
    }
    throw error;
  }

  // The principal was verified above, so an absent row means the account has
  // not been created yet — the sign-in flow's job, not this layout's.
  if (!account) redirect("/login");
  // An operator's decision in the CRM has to reach the product.
  if (isAccountLockedOut(account.status)) redirect("/login");
  if (!account.profileComplete) redirect("/complete-profile");

  return null;
}

async function renderAppLayout(children: React.ReactNode) {
  let principal;
  try {
    /*
     * Local signature verification, no database. This is the check that must
     * stay synchronous — see `AccountGate` above.
     */
    principal = await getAuthPrincipal();
  } catch (error) {
    /*
     * "WE COULD NOT CHECK" IS NOT "YOU ARE NOT SIGNED IN"
     * ---------------------------------------------------
     * A brief failure to reach Supabase used to arrive here as `null` — the
     * same value as a genuinely absent session — so a signed-in person was
     * redirected to `/login` mid-navigation and, on the pages that read before
     * the redirect landed, met `NotAuthenticatedError: Not signed in.` That is
     * the reported authentication instability, and `getAuthPrincipal` now
     * throws instead of lying (see `@/server/auth/session`).
     *
     * The response is deliberately *not* a redirect and *not* a crash. Signing
     * someone out because a network call failed destroys good state over a
     * problem that fixes itself in seconds. So the shell renders — navigation
     * stays usable — with a recoverable notice in the content area.
     */
    if (error instanceof AuthProviderUnavailableError) {
      return (
        <PrototypeStoreProvider>
          <AppShell>
            <SessionUnavailableNotice dependency="auth" />
          </AppShell>
        </PrototypeStoreProvider>
      );
    }

    /*
     * A DATABASE THAT CANNOT BE REACHED IS THE SAME KIND OF NON-ANSWER.
     *
     * This used to re-throw, so the pooler refusing one connection —
     * `(EMAXCONNSESSION) max clients reached in session mode`, five times in
     * eighty seconds on this project — took out the whole document and showed
     * a crash screen with no navigation and no way back except reloading.
     *
     * The reasoning is identical to the auth case above and the conclusion has
     * to be too: the gate asked "who is this" and got no reply. That is not a
     * reason to sign somebody out, and it is not a reason to destroy a page
     * that could have rendered its shell.
     *
     * **It grants nothing.** No account was resolved, so `PrototypeStoreProvider`
     * gets no data and every route below this layout is unreachable — the
     * notice replaces the children entirely. The retry re-runs this same gate,
     * which will redirect to `/login` if the session really has gone.
     */
    // A genuine fault belongs to the error boundary in `app/error.tsx`, which
    // is the boundary that covers a layout.
    throw error;
  }

  /*
   * No session at all: a real 307, before a byte of application HTML.
   * This is the check CLAUDE.md §19.5 is about and it is deliberately not
   * deferred.
   */
  if (!principal) redirect("/login");

  /*
   * The shell is returned now, without waiting for the database.
   *
   * `AccountGate` renders nothing on success; it exists to perform the
   * lockout and profile-complete redirects once the `users` row arrives. It
   * sits above `children` so that on a slow database the redirect still wins
   * the race against a page that is itself blocked on the same read.
   */
  return (
    <PrototypeStoreProvider>
      <AppShell>
        <Suspense fallback={null}>
          <AccountGate />
        </Suspense>
        {children}
      </AppShell>
    </PrototypeStoreProvider>
  );
}
