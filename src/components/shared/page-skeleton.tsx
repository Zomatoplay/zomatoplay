import { PageContainer } from "@/components/navigation/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The shapes a screen shows while its data is in flight.
 *
 * WHY THESE EXIST AT ALL
 * ----------------------
 * Every page in `(app)` awaits a database read before it returns any HTML, and
 * that read is a ~200ms round trip on a good day and several seconds when the
 * pooler is unhealthy. With no `loading.tsx` in the tree, Next has nothing to
 * show for that interval, so a slow navigation rendered as a **blank page** —
 * which is the "pages appear missing" symptom, not a crash.
 *
 * A `loading.tsx` also changes *when* the frame appears. It is the Suspense
 * fallback for the segment, so the shell — sidebar, bottom navigation, header —
 * is sent immediately and only the content area waits. The app stays navigable
 * while a screen loads instead of freezing on the previous one.
 *
 * WHY THEY MIRROR THE REAL LAYOUT
 * -------------------------------
 * Each skeleton is shaped like the screen it stands in for, so the content
 * lands in the same place it was outlined and the page does not jump. A generic
 * spinner would be less work and would reintroduce the layout shift these are
 * meant to prevent.
 *
 * Deliberately **not** client components: they render on the server as static
 * markup, so they cost nothing to hydrate and appear before any JavaScript
 * loads.
 */

/** The page header block: an eyebrow line above a title. */
export function TopBarSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-2">
      <Skeleton className="h-3 w-24 rounded-md" />
      <Skeleton className="mt-2 h-7 w-40 rounded-lg" />
    </div>
  );
}

/** A card-shaped block. `lines` outlines rows of text inside it. */
export function CardSkeleton({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div
      className={cn("space-y-3 rounded-2xl border border-border bg-card p-5", className)}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-4 rounded-md"
          // Staggered widths so a stack of rows reads as text rather than as a
          // block of identical bars.
          style={{ width: `${[70, 45, 88, 60, 78][i % 5]}%` }}
        />
      ))}
    </div>
  );
}

/** The inverted hero balance panel on Home and Wallet. */
export function BalanceSkeleton() {
  return (
    <div className="space-y-4 rounded-2xl bg-foreground/90 p-5">
      <Skeleton className="h-3 w-28 rounded-md bg-background/20" />
      <Skeleton className="h-9 w-48 rounded-lg bg-background/20" />
      <Skeleton className="h-3 w-32 rounded-md bg-background/20" />
    </div>
  );
}

/** A two-column grid of stat tiles. */
export function StatGridSkeleton({ tiles = 4 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: tiles }).map((_, i) => (
        <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4">
          <Skeleton className="h-3 w-20 rounded-md" />
          <Skeleton className="h-6 w-24 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/** A list of rows — transactions, allocations, settings entries. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2 rounded-md" />
            <Skeleton className="h-3 w-1/3 rounded-md" />
          </div>
          <Skeleton className="h-4 w-16 shrink-0 rounded-md" />
        </div>
      ))}
    </div>
  );
}

/**
 * The default whole-screen fallback.
 *
 * `aria-busy` and the visually-hidden line are what make this legible to a
 * screen reader: an outline of grey boxes conveys nothing without them, and
 * "loading" has to be announced rather than merely drawn.
 */
export function PageSkeleton({
  children,
  label = "Loading",
}: {
  children?: React.ReactNode;
  label?: string;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}…</span>
      <TopBarSkeleton />
      <PageContainer className="space-y-5">
        {children ?? (
          <>
            <CardSkeleton lines={3} />
            <CardSkeleton lines={2} />
            <ListSkeleton rows={4} />
          </>
        )}
      </PageContainer>
    </div>
  );
}
