"use client";

import { Component, type ReactNode } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Names the section in the fallback, e.g. "Earnings". */
  title: string;
}

interface State {
  failed: boolean;
  key: number;
}

/**
 * Keeps one failed section from taking the whole screen.
 *
 * WHY THIS EXISTS
 * ---------------
 * `(app)/error.tsx` is a *route* boundary: it replaces the entire page. Every
 * read a page issued sat in one `Promise.all`, so a single rejected secondary
 * query — a commission history, an earnings rollup — discarded the balance, the
 * navigation and the rest of the screen and rendered "Something went wrong".
 *
 * A wallet whose earnings panel is unavailable is still a useful wallet. A
 * wallet replaced by an error page is not, and it is a far worse thing to hand
 * someone who wants to check their money.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not a way to hide failures, and it must never wrap a primary reading.
 * The balance, the verification state and anything a person could act on
 * financially stay on the page's critical path: if those cannot be read, the
 * route boundary *should* take over, because a screen that quietly omits them
 * is a screen that misinforms. This is for genuinely secondary panels only.
 *
 * A class component because React error boundaries have no hook equivalent.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, key: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    // The server-side cause is already in `pipeline_events` with its own
    // correlation id; this is only so the section's failure is visible in a
    // browser console while developing.
    console.error("Section failed to render:", error);
  }

  private retry = () => {
    // Remounting the subtree re-runs the read. The server component below is
    // re-requested, so this is a genuine retry rather than a re-render of the
    // same rejected promise.
    this.setState((previous) => ({ failed: false, key: previous.key + 1 }));
  };

  render() {
    if (!this.state.failed) {
      return <div key={this.state.key}>{this.props.children}</div>;
    }

    return (
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div className="min-w-0 space-y-2">
            <p className="text-sm font-medium text-foreground">
              {this.props.title} could not be loaded
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              The rest of this page is unaffected and nothing on your account was
              changed.
            </p>
            <Button variant="outline" size="xs" onClick={this.retry}>
              <RotateCw className="size-3" aria-hidden />
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
