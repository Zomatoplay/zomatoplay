import { UsersView } from "@/components/admin/users/users-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getAdminUsers,
} from "@/server/services/admin.service";

export const metadata = { title: "Users" };

/**
 * The user directory.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const users = await getAdminUsers();

  return (
    <AdminDataProvider data={{ users }}>
      <UsersView />
    </AdminDataProvider>
  );
}
