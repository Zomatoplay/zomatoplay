import { AppShell } from "@/components/navigation/app-shell";
import { PrototypeStoreProvider } from "@/lib/prototype-store";

/**
 * The user-facing application frame: mobile-first, five primary sections,
 * fixed bottom navigation on phones and a sidebar from `lg`.
 *
 * This is a route group, so it adds no URL segment — every route below still
 * lives at its original path. It exists so the Master CRM under `/admin` can
 * have a completely different shell and its own state, without either area
 * inheriting the other's chrome.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <PrototypeStoreProvider>
      <AppShell>{children}</AppShell>
    </PrototypeStoreProvider>
  );
}
