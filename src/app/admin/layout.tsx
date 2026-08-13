import type { Metadata } from "next";

import { AdminShell } from "@/components/admin/layout/admin-shell";
import { ADMIN_APP_SUBTITLE } from "@/constants/admin";
import { AdminStoreProvider } from "@/lib/admin-store";

/**
 * Master CRM frame.
 *
 * Architecturally separate from the user application: its own store, its own
 * navigation, its own shell. Nothing under `/admin` imports the user app's
 * `AppShell`, bottom navigation or prototype store, and nothing in the user app
 * imports anything from here.
 */

export const metadata: Metadata = {
  title: {
    default: ADMIN_APP_SUBTITLE,
    template: `%s · ${ADMIN_APP_SUBTITLE}`,
  },
  description:
    "Administrative control panel for the Nanotron platform. Prototype build with sample data.",
  // An operations console has no business being indexed.
  robots: { index: false, follow: false },
};

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AdminStoreProvider>
      <AdminShell>{children}</AdminShell>
    </AdminStoreProvider>
  );
}
