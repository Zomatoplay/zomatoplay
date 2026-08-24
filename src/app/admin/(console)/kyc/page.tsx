import { KycView } from "@/components/admin/kyc/kyc-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getKycSubmissions,
} from "@/server/services/admin.service";

export const metadata = { title: "KYC" };

/**
 * The verification review queue.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const kyc = await getKycSubmissions();

  return (
    <AdminDataProvider data={{ kyc }}>
      <KycView />
    </AdminDataProvider>
  );
}
