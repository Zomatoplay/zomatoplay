import { BottomNavigation } from "@/components/navigation/bottom-navigation";
import { DesktopSidebar } from "@/components/navigation/desktop-sidebar";
import { cn } from "@/lib/utils";

/**
 * The frame every screen renders inside.
 *
 * Mobile  — single column, fixed bottom navigation, content padded by `.pb-nav`
 *           so the bar never overlaps the last element.
 * Desktop — the same single column, offset by a 16rem sidebar. Deliberately
 *           not widened into a multi-column dashboard: desktop is a roomier
 *           frame around the mobile app, not a different product.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <DesktopSidebar />
      <div className="lg:pl-64">{children}</div>
      <BottomNavigation />
    </div>
  );
}

/**
 * Standard content column. Centres and caps the width so desktop stays
 * readable, and reserves space for the bottom navigation.
 */
export function PageContainer({
  children,
  className,
  /** Set false on screens with their own footer/action bar. */
  reserveNavSpace = true,
}: {
  children: React.ReactNode;
  className?: string;
  reserveNavSpace?: boolean;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "mx-auto w-full max-w-2xl px-4 pt-2 focus:outline-none",
        reserveNavSpace ? "pb-nav lg:pb-10" : "pb-6",
        className,
      )}
    >
      {children}
    </main>
  );
}
