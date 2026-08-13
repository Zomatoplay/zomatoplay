import { AdminSidebar } from "@/components/admin/layout/admin-sidebar";
import { cn } from "@/lib/utils";

/**
 * The frame every Master CRM screen renders inside.
 *
 * Desktop-first, unlike the user application: a fixed 16rem sidebar from `lg`
 * and a wide content column, because this is an operations tool used at a desk.
 * Below `lg` the sidebar becomes a drawer in the header and the content
 * collapses to a single column — usable on a tablet or phone without
 * pretending to be a mobile-first product.
 *
 * Deliberately does NOT reuse the user application's `AppShell`: no bottom
 * navigation, no `.pb-nav` reservation, no 2xl content cap.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-background">
      <AdminSidebar />
      <div className="lg:pl-64">{children}</div>
    </div>
  );
}

/**
 * Standard CRM content column. Wider than the user app's, capped so tables stay
 * readable on ultrawide displays.
 */
export function AdminPage({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className={cn(
        "mx-auto w-full max-w-[90rem] px-3 py-5 focus:outline-none sm:px-5 lg:px-8",
        // Room below the last element on short viewports.
        "pb-16",
        className,
      )}
    >
      {children}
    </main>
  );
}

/**
 * A titled block within a page. Used instead of ad-hoc heading markup so the
 * document outline stays correct across a dozen screens.
 */
export function AdminSection({
  title,
  description,
  actions,
  children,
  className,
  headingLevel: Heading = "h2",
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headingLevel?: "h2" | "h3";
}) {
  return (
    <section className={cn("space-y-3", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            {title ? (
              <Heading className="text-base font-semibold tracking-tight text-foreground">
                {title}
              </Heading>
            ) : null}
            {description ? (
              <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
