import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/layout/admin-shell";
import { AdminStoreProvider } from "@/lib/admin-store";
import {
  getCurrentOperator,
  toSessionView,
  AdminAuthorizationError,
} from "@/server/admin/session";
import { getAdminShell } from "@/server/services/admin.service";

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

  const shell = await getAdminShell();

  return (
    <AdminStoreProvider session={toSessionView(operator)} shell={shell}>
      <AdminShell>{children}</AdminShell>
    </AdminStoreProvider>
  );
}
