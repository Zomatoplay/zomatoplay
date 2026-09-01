import { AuditLogsView } from "@/components/admin/audit/audit-logs-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminAgents,
  getAuditLog,
} from "@/server/services/admin.service";

export const metadata = { title: "Audit logs" };

/**
 * The append-only audit trail. Read-only here, and it must stay that way.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const [auditLog, agents] = await Promise.all([
    getAuditLog(),
    // The screen resolves each entry's actor against the operator directory and
    // counts the distinct agents in the log. It used to take that from the
    // console shell, which every other admin page then paid two round trips
    // for — and which, because a layout does not re-run on a client
    // navigation, was frozen at whatever the directory held when the console
    // was opened.
    getAdminAgents(),
  ]);

  return (
    <AdminDataProvider data={{ auditLog, agents }}>
      <AuditLogsView />
    </AdminDataProvider>
  );
}
