"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The console could not establish who the operator is.
 *
 * WHAT THIS REPLACES, AND WHY IT IS NOT THE SIGN-IN PAGE
 * ------------------------------------------------------
 * The gate used to do one of two things when `getCurrentOperator()` threw: a
 * disabled account redirected to `/admin/login` with a reason, and everything
 * else re-threw into the error boundary. "Everything else" includes the
 * Supabase pooler refusing a connection, which is what actually happened on
 * 2026-09-14 — so an infrastructure blip became a full-page crash in the
 * console an operator would be opening precisely to investigate it.
 *
 * Redirecting to sign-in would be worse, not better: the operator's credential
 * is fine, and sending them to re-enter it invites exactly the "sign in five
 * times" loop this work exists to end.
 *
 * So: no console, no operator data, no grant of any kind — just an honest
 * statement and a retry that re-runs the gate. If the operator session has
 * genuinely gone, that pass redirects to sign-in, which is the right answer
 * reached the right way.
 */
export function ConsoleUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md space-y-4 p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-warning/12 text-warning">
          <CloudOff className="size-6" aria-hidden />
        </span>
        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold tracking-tight">
            The console is temporarily unavailable
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            We could not reach the operator directory to confirm your access.
            You have not been signed out, and nothing is wrong with your
            credentials — this is usually over in a few seconds.
          </p>
        </div>
        <Button
          variant="brand"
          size="sm"
          disabled={pending}
          onClick={() => {
            setTried(true);
            startTransition(() => router.refresh());
          }}
        >
          <RotateCw className="size-4" aria-hidden />
          {pending ? "Retrying…" : "Retry"}
        </Button>
        {tried && !pending ? (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Still not responding. The system log at <code>/admin/system-logs</code>{" "}
            records the underlying failure once the console opens.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
