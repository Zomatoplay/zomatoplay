import { NotificationsView } from "@/components/admin/notifications/notifications-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminUsers,
  getNotificationCampaigns,
} from "@/server/services/admin.service";

export const metadata = { title: "Notifications" };

/**
 * The campaign composer and its send history.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const [campaigns, users] = await Promise.all([
    getNotificationCampaigns(),
    // The composer resolves a single-user audience against the directory.
    getAdminUsers(),
  ]);

  return (
    <AdminDataProvider data={{ campaigns, users }}>
      <NotificationsView />
    </AdminDataProvider>
  );
}
