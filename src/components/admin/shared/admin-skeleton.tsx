import { AdminPage } from "@/components/admin/layout/admin-shell";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * What a console screen shows while its slice is in flight.
 *
 * The CRM's pages each read their own data (§4.2), so every one of them awaited
 * a database round trip before returning any markup and had no fallback to show
 * during it. As in the user app, the practical result of a slow pooler was a
 * blank screen rather than a slow one.
 *
 * Table-shaped, because every list screen in the console is a `DataTable`: a
 * header strip, a filter row, then rows. Server-rendered, so it appears before
 * any JavaScript loads.
 */
export function AdminTableSkeleton({
  rows = 8,
  label = "Loading",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <AdminPage className="space-y-5">
      {/*
        `aria-busy` lives on this wrapper rather than on `AdminPage`: that
        component renders a fixed `<main>` and does not spread extra props, so
        an aria attribute passed to it is accepted by TypeScript (JSX always
        permits `aria-*`) and then silently dropped before it reaches the DOM.
      */}
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}…</span>
      </div>

      {/* Page title */}
      <div className="space-y-2">
        <Skeleton className="h-3 w-28 rounded-md" />
        <Skeleton className="h-7 w-56 rounded-lg" />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-full max-w-xs rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
        <Skeleton className="h-9 w-32 rounded-xl" />
      </div>

      {/* Table body */}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="hidden h-4 w-28 rounded-md sm:block" />
            <Skeleton className="hidden h-4 w-24 rounded-md md:block" />
            <Skeleton className="ml-auto h-4 w-20 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </AdminPage>
  );
}

/** The dashboard: a stat row, then chart frames. */
export function AdminDashboardSkeleton() {
  return (
    <AdminPage className="space-y-5">
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading the dashboard…</span>
      </div>

      <div className="space-y-2">
        <Skeleton className="h-3 w-28 rounded-md" />
        <Skeleton className="h-7 w-48 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          // `min-w-0`: as grid children the default `min-width: auto` lets
          // content widen the track past the viewport (§15.5).
          <div
            key={i}
            className="min-w-0 space-y-2 rounded-2xl border border-border bg-card p-4"
          >
            <Skeleton className="h-3 w-24 rounded-md" />
            <Skeleton className="h-7 w-20 rounded-md" />
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="min-w-0 space-y-3 rounded-2xl border border-border bg-card p-5"
          >
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </AdminPage>
  );
}

/**
 * The filter row and table body alone, with no page title.
 *
 * The Suspense fallback for a list screen that has already rendered its own
 * header. `AdminTableSkeleton` above is the *route* fallback (`loading.tsx`),
 * where nothing at all is on screen yet and the title is part of what is
 * missing; here the header, the sidebar and the page chrome are already
 * painted and only the data region is in flight. Replacing a title that is
 * already correct with a grey bar would be a step backwards.
 */
export function AdminListSkeleton({
  rows = 10,
  label = "Loading",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="space-y-4">
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}…</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-11 w-full max-w-xs rounded-xl" />
        <Skeleton className="h-11 w-32 rounded-xl" />
        <Skeleton className="h-11 w-32 rounded-xl" />
      </div>

      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-40 rounded-md" />
            <Skeleton className="hidden h-4 w-28 rounded-md sm:block" />
            <Skeleton className="hidden h-4 w-24 rounded-md md:block" />
            <Skeleton className="ml-auto h-4 w-20 shrink-0 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
