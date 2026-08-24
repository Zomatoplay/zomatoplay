"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The boundary for failures in a *layout*.
 *
 * WHY THIS FILE HAD TO EXIST
 * --------------------------
 * An error boundary catches errors from the segments **below** it, not from the
 * layout beside it. `(app)/error.tsx` therefore never covered
 * `(app)/layout.tsx`, and `admin/(console)/error.tsx` never covered the console
 * layout — which is exactly where the gate lives, and exactly where the two
 * riskiest calls in the application are made: verifying the session and
 * resolving the account.
 *
 * With no boundary at this level those failures had nowhere to land. A database
 * timeout while resolving the account, or the auth provider being briefly
 * unreachable, took out the whole document instead of one screen. That is the
 * reported "application crashes" symptom, and this is the missing piece.
 *
 * Deliberately dependency-free: no shell, no store, no navigation. Whatever
 * failed may well be the thing those need, so this renders from nothing but
 * design tokens.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Next strips the message before it reaches a client boundary in
    // production, leaving only `digest`. Classification happens server-side
    // (`@/server/errors`) and lands in `pipeline_events`; the digest is what
    // ties this screen to that row.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-16">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary">
          <TriangleAlert className="size-5 text-muted-foreground" aria-hidden />
        </div>

        <div className="space-y-2">
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Unable to load this information
          </h1>
          {/*
            No stack trace, no SQL, no connection string — only what a person can
            act on. The reassurance about account state is the important half:
            this boundary is reached by read failures, so nothing was changed,
            and saying so stops a retry feeling risky.
          */}
          <p className="text-sm leading-relaxed text-muted-foreground">
            This is usually temporary and nothing on your account was changed.
            Try again in a moment.
          </p>
        </div>

        <div className="space-y-3">
          <Button variant="brand" size="sm" onClick={reset}>
            Retry
          </Button>
          {error.digest ? (
            <p className="text-[11px] text-muted-foreground">
              Reference <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
