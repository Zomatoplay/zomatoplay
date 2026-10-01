import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/layout/admin-shell";
import { ConsoleUnavailable } from "@/components/admin/layout/console-unavailable";
import { AdminStoreProvider } from "@/lib/admin-store";
import {
  getCurrentOperator,
  toSessionView,
  AdminAuthorizationError,
} from "@/server/admin/session";
import { readOperatorSessionClaims } from "@/server/admin/operator-session";
import { getAdminShell } from "@/server/services/admin.service";
import { isInfrastructureFailure } from "@/server/errors";
import {
  describeError,
  errorDiagnostics,
  recordPipelineEvent,
} from "@/server/observability";
import { traceRender } from "@/server/trace-action";

/**
 * The operations console — and the gate in front of it.
 *
 * THE GATE
 * --------
 * Every route below this layout reads or changes platform data: other people's
 * verification documents, their balances, their account status. None of it is
 * visible without an operator session, resolved server-side from a verified
 * Supabase principal and re-checked on every request.
 *
 * This replaced a demo session switcher in the header. The console used to open
 * as the master admin with no sign-in at all, and the "operator" a mutation
 * claimed to be was whatever the browser said.
 *
 * WHAT THIS LAYOUT READS, AND WHAT IT NO LONGER READS
 * ---------------------------------------------------
 * The shell only: the operator's own session and the platform settings the
 * sidebar and permission gates need. It used to read the *whole platform* —
 * fourteen queries, every user, every deposit, every audit entry — on every
 * admin page load, and hand it all to the store.
 *
 * That was wrong twice over. It cost 2.2 seconds against a database with a
 * 200ms round-trip floor, on a page that might only need one of the fourteen.
 * And because Next.js re-renders only the *changed* route segments on a client
 * navigation, a layout does not run again — so the snapshot taken when the
 * console was opened was the snapshot every screen kept showing. A verification
 * case submitted after that never appeared until a hard reload. Each page now
 * reads its own slice, and a page segment does re-render.
 */
export const dynamic = "force-dynamic";

export default async function AdminConsoleLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return traceRender({ route: "/admin", actorType: "admin" }, () =>
    renderConsoleLayout(children),
  );
}

/**
 * Wrapped in a trace, as the user application's layout already was.
 *
 * Without it, every event this layout records — the session resolution, the
 * operator lookup — found no trace and took the immediate path in
 * `recordPipelineEvent`, which coalesces on a 100ms timer. Because those two
 * events land ~360ms apart, that was **two `INSERT`s per admin page load, both
 * issued while the page was still rendering**, holding connections from the
 * same pool the render was reading through. CLAUDE.md §22.1a is explicit that
 * recording must never be measurable, and this was measurable.
 *
 * Inside a trace they buffer and flush once, through `after()`, so the insert
 * happens after the response instead of competing with it. It also gives an
 * admin navigation a `render.complete` span under the same correlation id as
 * the browser's `navigation.start`, which is what makes the console's own
 * system log able to explain an admin navigation at all.
 */
async function renderConsoleLayout(children: React.ReactNode) {
  /*
   * THE OPERATOR AND THE SHELL ARE READ CONCURRENTLY, AND THAT IS SAFE
   * ------------------------------------------------------------------
   * These were sequential — resolve the operator, then read the shell — which
   * made the layout two round trips deep in front of every page beneath it.
   * Measured at ~370ms per wave, so the console paid an extra wave on every
   * full page load for an ordering nothing needed: `getAdminShell()` does not
   * take the operator as an argument and does not vary by who is asking.
   *
   * The gate is unchanged and still runs before anything is *rendered*. What
   * changes is only that the settings row is fetched while the operator lookup
   * is in flight, and thrown away if the caller turns out not to be one.
   *
   * The exposure that creates is bounded and small, and worth stating exactly:
   * a caller holding a validly signed operator cookie whose operator no longer
   * resolves (signed out elsewhere, number changed) can cause one extra
   * `platform_settings` read whose result is never sent to them. Nothing here returns data before `operator` has been checked.
   *
   * THE PRINCIPAL IS RESOLVED FIRST, AND IT HAS TO BE
   * -------------------------------------------------
   * That property was *claimed* here before it was true. The shell read was
   * started at the top of this function, before anything had looked at the
   * request at all, so an anonymous caller — no cookie, no token — did reach
   * it. Measured during a real outage on 2026-09-18, with the pooler
   * unreachable: `GET /admin` with no session took **15.2 seconds** to answer
   * and then redirected, because the discarded `platform_settings` read sat on
   * the full `DATABASE_QUERY_TIMEOUT_MS` deadline. Every `(app)` route answered
   * the same request in ~200ms, because none of them reads anything before the
   * gate.
   *
   * The operator session cookie is checked first: its HMAC is verified
   * in-process (`readOperatorSessionClaims`, request-memoised and reused by
   * `getCurrentOperator()` below), so it costs no round trip, and a request
   * with no valid operator cookie never reaches the database.
   *
   * It used to be `getAuthPrincipal()` — a *Supabase* session — which is not
   * how operators sign in any more (§20). An SMS-signed-in operator has no
   * Supabase session, so this gate sent them to `/admin/login`, which saw a
   * valid operator cookie and sent them back: a redirect loop on every
   * console URL opened directly.
   */
  const claims = await readOperatorSessionClaims();
  if (!claims) redirect("/admin/login");

  const shellPromise = getAdminShell();
  // Claimed immediately: if the operator check redirects, nothing awaits this
  // promise, and an unhandled rejection would take the process down.
  shellPromise.catch(() => {});

  let operator;
  try {
    operator = await getCurrentOperator();
  } catch (error) {
    // A real verdict about this operator — disabled, suspended. Sending them to
    // sign-in with the reason is correct: there is nothing to retry.
    if (error instanceof AdminAuthorizationError) {
      redirect(`/admin/login?reason=${encodeURIComponent(error.message)}`);
    }

    /*
     * NO VERDICT WAS REACHED, SO NEITHER OPENING NOR DESTROYING IS RIGHT.
     *
     * A refused connection used to re-throw from here into the error boundary,
     * which is how a two-second pooler fault turned into "Something went wrong"
     * across the whole console. Redirecting to `/admin/login` would be worse
     * still — the credential is fine, and it teaches operators to re-enter it.
     *
     * The console is **not** rendered: `operator` is still undefined, no shell
     * data is read, and `children` never appear. This is a terminal, honest
     * state with a retry that runs the same gate again.
     */
    if (isInfrastructureFailure(error)) {
      recordPipelineEvent({
        pipeline: "admin",
        operation: "admin.gate.degraded",
        status: "failed",
        message: "The operator gate could not reach the database; console refused",
        errorMessage: describeError(error),
        metadata: errorDiagnostics(error),
      });
      return <ConsoleUnavailable />;
    }

    throw error;
  }

  if (!operator) redirect("/admin/login");

  const shell = await shellPromise;

  return (
    <AdminStoreProvider session={toSessionView(operator)} shell={shell}>
      <AdminShell>{children}</AdminShell>
    </AdminStoreProvider>
  );
}
