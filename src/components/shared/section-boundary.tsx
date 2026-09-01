import { Suspense, type ReactNode } from "react";

import { SectionErrorBoundary } from "./section-error-boundary";

interface SectionBoundaryProps {
  /** Names the section in the failure notice, e.g. "Earnings". */
  title: string;
  /** Shown while the section's reads are still in flight. */
  fallback: ReactNode;
  children: ReactNode;
}

/**
 * A secondary section that loads and fails on its own.
 *
 * Two boundaries, in the order that matters: the error boundary is *outside*
 * the Suspense boundary, so a rejected read is caught rather than suspending
 * forever, and a slow one still shows the skeleton.
 *
 * HOW TO USE IT WITHOUT REINTRODUCING A WATERFALL
 * -----------------------------------------------
 * Start the read in the **page** and pass the unawaited promise down; await it
 * inside the child. Starting it in the child instead would delay it until React
 * reaches that component — a whole extra round trip, which is the trap
 * documented in CLAUDE.md §16.1a item 6 and the reason `TopBar` reads through
 * the page's own wave.
 *
 *     const earnings = getEarningsSummary();        // started, not awaited
 *     <SectionBoundary title="Earnings" fallback={<CardSkeleton />}>
 *       <EarningsSection earnings={earnings} />     // awaits it in here
 *     </SectionBoundary>
 *
 * Secondary panels only. See the note in `SectionErrorBoundary` for why a
 * balance or a verification state must never be wrapped in one of these.
 */
export function SectionBoundary({
  title,
  fallback,
  children,
}: SectionBoundaryProps) {
  return (
    <SectionErrorBoundary title={title}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </SectionErrorBoundary>
  );
}

/**
 * Marks a promise as handled so an early rejection cannot surface as an
 * unhandled rejection before React gets to consume it.
 *
 * The returned promise is the original one: attaching a no-op `catch` creates a
 * second promise and discards it, which is enough for Node to consider the
 * rejection observed. The consumer still sees the rejection, which is the whole
 * point — the section boundary needs it.
 */
export function deferred<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}
