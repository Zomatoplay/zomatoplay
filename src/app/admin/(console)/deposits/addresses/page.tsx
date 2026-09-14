import { DepositAddressesView } from "@/components/admin/money/deposit-addresses-view";
import { AdminDataProvider } from "@/lib/admin-store";
import { getAdminDepositAddresses } from "@/server/services/admin.service";

export const metadata = { title: "Deposit addresses" };

/**
 * The deposit-address pool.
 *
 * A route of its own rather than a tab on `/admin/deposits`, because the two
 * screens answer different questions and read different tables: that one is a
 * queue of transfers to work through, this one is the receiving infrastructure
 * behind it. Bundling them would also make the deposits page pay for this
 * page's queries on every visit.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database after an address is added, released or retired.
 */
export default async function Page() {
  const depositAddresses = await getAdminDepositAddresses();

  return (
    <AdminDataProvider data={{ depositAddresses }}>
      <DepositAddressesView />
    </AdminDataProvider>
  );
}
