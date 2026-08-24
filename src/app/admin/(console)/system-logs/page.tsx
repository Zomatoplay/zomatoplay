import { SystemLogsView } from "@/components/admin/system/system-logs-view";
import { AdminDataProvider } from "@/lib/admin-store";
import { getPipelineEvents } from "@/server/services/admin.service";

export const metadata = { title: "System logs" };

/**
 * Integration and pipeline observability.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function AdminSystemLogsPage() {
  const pipelineEvents = await getPipelineEvents();

  return (
    <AdminDataProvider data={{ pipelineEvents }}>
      <SystemLogsView />
    </AdminDataProvider>
  );
}
