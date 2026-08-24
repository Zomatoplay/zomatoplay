import { DashboardView } from "@/components/admin/dashboard/dashboard-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminDeposits,
  getAdminUsers,
  getAdminWithdrawals,
  getKycSubmissions,
} from "@/server/services/admin.service";

export const metadata = { title: "Dashboard" };

/**
 * Queue counts, platform totals and the recent-activity panels.
 *
 * The four slices the panels actually render, read in parallel. This is the
 * heaviest admin page by design — it is the one screen that legitimately spans
 * several areas — and it is still four queries rather than the fourteen every
 * admin page used to pay for.
 */
export default async function AdminDashboardPage() {
  const [users, deposits, withdrawals, kyc] = await Promise.all([
    getAdminUsers(),
    getAdminDeposits(),
    getAdminWithdrawals(),
    getKycSubmissions(),
  ]);

  return (
    <AdminDataProvider data={{ users, deposits, withdrawals, kyc }}>
      <DashboardView />
    </AdminDataProvider>
  );
}
