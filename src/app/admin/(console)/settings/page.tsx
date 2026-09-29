import { SettingsView } from "@/components/admin/settings/settings-view";
import { AdminDataProvider } from "@/lib/admin-store";
import {
  getPlatformSettings,
} from "@/server/services/admin.service";
import { getSupportTelegramUrl } from "@/server/services/catalogue.service";

export const metadata = { title: "Settings" };

/**
 * Platform configuration.
 *
 * Read here rather than in the layout: a page segment re-renders on a client
 * navigation and on `router.refresh()`, so this is what keeps the screen in
 * step with the database. It also means this route pays for its own queries and
 * nobody else's.
 */
export default async function Page() {
  const [settings, supportTelegramUrl] = await Promise.all([
    getPlatformSettings(),
    getSupportTelegramUrl(),
  ]);

  return (
    <AdminDataProvider data={{ settings }}>
      <SettingsView supportTelegramUrl={supportTelegramUrl} />
    </AdminDataProvider>
  );
}
