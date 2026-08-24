import { AgentsView } from "@/components/admin/agents/agents-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminAgents,
} from "@/server/services/admin.service";

export const metadata = { title: "Agents" };

/**
 * The operator directory and permission matrix.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const agents = await getAdminAgents();

  return (
    <AdminDataProvider data={{ agents }}>
      <AgentsView />
    </AdminDataProvider>
  );
}
