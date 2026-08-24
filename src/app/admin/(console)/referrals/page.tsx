import { ReferralsView } from "@/components/admin/referrals/referrals-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminCommissionLedger,
  getAdminReferralAccounts,
} from "@/server/services/admin.service";

export const metadata = { title: "Referrals" };

/**
 * Referral accounts and the commission ledger.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const [referralAccounts, commissionLedger] = await Promise.all([
    getAdminReferralAccounts(),
    getAdminCommissionLedger(),
  ]);

  return (
    <AdminDataProvider data={{ referralAccounts, commissionLedger }}>
      <ReferralsView />
    </AdminDataProvider>
  );
}
