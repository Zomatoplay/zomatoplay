import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/layout/admin-shell";
import { AdminStoreProvider } from "@/lib/admin-store";
import {
  getCurrentOperator,
  toSessionView,
  AdminAuthorizationError,
} from "@/server/admin/session";
import { getAdminShell } from "@/server/services/admin.service";
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
   * a caller who already holds a **verified Supabase JWT** but is not an
   * operator can now cause one extra `platform_settings` read whose result is
   * never sent to them. `getAuthPrincipal()` is resolved first and costs no
   * round trip — it verifies the token's signature locally — so an anonymous or
   * forged-token caller reaches neither read. Nothing here returns data before
   * `operator` has been checked.
   */
  const shellPromise = getAdminShell();
  // Claimed immediately: if the operator check redirects, nothing awaits this
  // promise, and an unhandled rejection would take the process down.
  shellPromise.catch(() => {});

  let operator;
  try {
    operator = await getCurrentOperator();
  } catch (error) {
    if (error instanceof AdminAuthorizationError) {
      redirect(`/admin/login?reason=${encodeURIComponent(error.message)}`);
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
