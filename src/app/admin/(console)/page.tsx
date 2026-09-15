import { DashboardView } from "@/components/admin/dashboard/dashboard-view";
import { AdminDataProvider } from "@/lib/admin-store";
import { getAdminDashboard } from "@/server/services/admin.service";

export const metadata = { title: "Dashboard" };

/**
 * Queue counts, platform totals and the recent-activity panels.
 *
 * WHAT THIS PAGE USED TO COST
 * ---------------------------
 * Four unbounded reads — every user joined to every wallet, every deposit,
 * every withdrawal, and every KYC case (itself three unbounded queries,
 * because attaching documents and notes read every document and every note on
 * the platform). All four were serialised whole into the RSC payload so the
 * browser could derive six counts and slice five rows off each list.
 *
 * `getAdminDashboard()` reads the six figures as one aggregate statement and
 * the six panels as six `LIMIT`ed queries, so what crosses the wire stops
 * growing with the platform. It also fetches the two slices this page never
 * provided, which is why two of its six panels always rendered empty.
 */
export default async function AdminDashboardPage() {
  const { metrics, users, deposits, withdrawals, kyc, investments, securityEvents } =
    await getAdminDashboard();

  return (
    <AdminDataProvider
      data={{ users, deposits, withdrawals, kyc, investments, securityEvents }}
    >
      <DashboardView metrics={metrics} />
    </AdminDataProvider>
  );
}
