import { InvestmentsView } from "@/components/admin/money/investments-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminInvestments,
  getAdminPlans,
} from "@/server/services/admin.service";

export const metadata = { title: "Investments" };

/**
 * Every allocation, filterable by plan.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const [investments, plans] = await Promise.all([
    getAdminInvestments(),
    getAdminPlans(),
  ]);

  return (
    <AdminDataProvider data={{ investments, plans }}>
      <InvestmentsView />
    </AdminDataProvider>
  );
}
