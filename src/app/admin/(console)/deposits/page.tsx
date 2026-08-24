import { DepositsView } from "@/components/admin/money/deposits-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminDeposits,
  getAdminUsers,
} from "@/server/services/admin.service";

export const metadata = { title: "Deposits" };

/**
 * The deposit ledger and the attribution queue.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const [deposits, users] = await Promise.all([
    getAdminDeposits(),
    // The assignment dialog picks an account to attribute a transfer to, so it
    // needs the directory as well as the queue.
    getAdminUsers(),
  ]);

  return (
    <AdminDataProvider data={{ deposits, users }}>
      <DepositsView />
    </AdminDataProvider>
  );
}
