import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { DepositConfigurationView } from "@/components/admin/money/deposit-configuration-view";
import { getDepositConfigurationForAdmin } from "@/server/services/deposit-settings.service";

export const metadata = { title: "Deposit configuration" };

/**
 * The single deposit address — replaces the per-user address pool screen.
 *
 * Read in the page, not the layout (§4.2), so a save followed by
 * `router.refresh()` shows the new value immediately.
 */
export default async function Page() {
  const configuration = await getDepositConfigurationForAdmin();

  return (
    <>
      <AdminHeader
        title="Deposit configuration"
        description="The one address customers send USDT (TRC-20) to."
      />
      <AdminPage>
        <PermissionGate permission="deposits">
          <DepositConfigurationView configuration={configuration} />
        </PermissionGate>
      </AdminPage>
    </>
  );
}
