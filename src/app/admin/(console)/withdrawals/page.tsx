import { WithdrawalsView } from "@/components/admin/money/withdrawals-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminWithdrawals,
} from "@/server/services/admin.service";

export const metadata = { title: "Withdrawals" };

/**
 * The payout queue.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const withdrawals = await getAdminWithdrawals();

  return (
    <AdminDataProvider data={{ withdrawals }}>
      <WithdrawalsView />
    </AdminDataProvider>
  );
}
