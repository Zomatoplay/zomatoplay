import { AuditLogsView } from "@/components/admin/audit/audit-logs-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
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
  const auditLog = await getAuditLog();

  return (
    <AdminDataProvider data={{ auditLog }}>
      <AuditLogsView />
    </AdminDataProvider>
  );
}
