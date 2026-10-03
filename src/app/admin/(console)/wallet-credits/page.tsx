import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { ManualCreditView } from "@/components/admin/money/manual-credit-view";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { AdminAuthorizationError, requirePermission } from "@/server/admin/session";
import { listRecentManualCredits } from "@/server/services/manual-credit.service";

export const metadata = { title: "Manual Funds" };

/**
 * Manual USDT credits: the form, and the recent history.
 *
 * The history is read only after the server confirms `view` over
 * `wallet_credits` — `PermissionGate` below is the client's courtesy, this is
 * the check, so an operator without the grant never receives the rows.
 */
export default async function Page() {
  let recent = null;
  try {
    await requirePermission("wallet_credits", "view");
    recent = await listRecentManualCredits(25);
  } catch (error) {
    if (!(error instanceof AdminAuthorizationError)) throw error;
  }

  return (
    <>
      <AdminHeader
        title="Manual Funds"
        description="Credit or debit USDT on a customer's wallet through the ledger."
      />
      <AdminPage>
        <PermissionGate permission="wallet_credits">
          <ManualCreditView recent={recent} />
        </PermissionGate>
      </AdminPage>
    </>
  );
}
