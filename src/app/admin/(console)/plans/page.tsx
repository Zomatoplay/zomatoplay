import { PlansView } from "@/components/admin/plans/plans-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminPlans,
} from "@/server/services/admin.service";

export const metadata = { title: "Plans" };

/**
 * The plan catalogue the public application also reads.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const plans = await getAdminPlans();

  return (
    <AdminDataProvider data={{ plans }}>
      <PlansView />
    </AdminDataProvider>
  );
}
