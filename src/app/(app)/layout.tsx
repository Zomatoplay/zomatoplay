import { redirect } from "next/navigation";

import { AppShell } from "@/components/navigation/app-shell";
import { SessionUnavailableNotice } from "@/components/shared/session-unavailable-notice";
import { PrototypeStoreProvider } from "@/lib/prototype-store";
import { getAuthenticatedAccount, isAccountLockedOut } from "@/server/auth/account";
import { AuthProviderUnavailableError } from "@/server/auth/session";
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

async function renderAppLayout(children: React.ReactNode) {
  let account;
  try {
    account = await getAuthenticatedAccount();
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
    if (isInfrastructureFailure(error)) {
      recordPipelineEvent({
        pipeline: "auth",
        operation: "auth.gate.degraded",
        status: "failed",
        message: "The account gate could not reach the database; shell rendered",
        errorMessage: describeError(error),
        metadata: errorDiagnostics(error),
      });
      return (
        <PrototypeStoreProvider>
          <AppShell>
            <SessionUnavailableNotice dependency="database" />
          </AppShell>
        </PrototypeStoreProvider>
      );
    }

    // A genuine fault belongs to the error boundary in `app/error.tsx`, which
    // is the boundary that covers a layout.
    throw error;
  }

  if (!account) redirect("/login");
  // An operator's decision in the CRM has to reach the product, or the CRM is
  // describing something that did not happen. Blocking, suspending or
  // deactivating an account takes effect on its next request.
  if (isAccountLockedOut(account.status)) redirect("/login");
  // A verified email with no name or phone yet: finish that before anything
  // else, so the rest of the app never has to render a half-built account.
  if (!account.profileComplete) redirect("/complete-profile");

  // No account data is read here, deliberately: an await in a layout gates
  // every page beneath it. See `@/server/services/account.service`.
  return (
    <PrototypeStoreProvider>
      <AppShell>{children}</AppShell>
    </PrototypeStoreProvider>
  );
}
