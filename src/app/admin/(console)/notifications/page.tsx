import { NotificationsView } from "@/components/admin/notifications/notifications-view";
import { AdminDataProvider } from "@/lib/admin-store";
import { getNotificationCampaigns } from "@/server/services/admin.service";

export const metadata = { title: "Notifications" };

/**
 * The campaign composer and its send history.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 *
 * It used to read the **entire user directory** as well, purely so the
 * composer's single-user audience could resolve a typed name with a `find()`
 * in the browser. That is now `searchUsersAction` — gated on `users: view`,
 * at most eight narrow rows, nothing under two characters — so this screen no
 * longer pays for the platform in order to address one person.
 */
export default async function Page() {
  const campaigns = await getNotificationCampaigns();

  return (
    <AdminDataProvider data={{ campaigns }}>
      <NotificationsView />
    </AdminDataProvider>
  );
}
