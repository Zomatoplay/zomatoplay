"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CloudOff } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Shown when the sign-in service could not be reached.
 *
 * Not a sign-out and not a crash. The session is very probably still valid —
 * what failed is the check, not the credential — so this offers a retry and
 * keeps the shell around it, rather than clearing state and sending the person
 * to `/login`.
 *
 * `router.refresh()` re-runs the server render, which re-runs the gate. If the
 * provider has come back the person lands on the page they wanted with no
 * further action; if their session really has expired, the gate redirects to
 * sign-in on that pass, which is the correct outcome reached the correct way.
 */
export function SessionUnavailableNotice() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tried, setTried] = useState(false);

  return (
    <PageContainer className="pt-16">
      <EmptyState
        icon={CloudOff}
        title="Unable to confirm your sign-in"
        description="We could not reach the sign-in service just now. You have not been signed out — this is usually temporary."
        action={
          <div className="space-y-3">
            <Button
              variant="brand"
              size="sm"
              disabled={pending}
              onClick={() => {
                setTried(true);
                startTransition(() => router.refresh());
              }}
            >
              {pending ? "Retrying…" : "Retry"}
            </Button>
            {tried && !pending ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Still not responding. Please try again in a moment.
              </p>
            ) : null}
          </div>
        }
      />
    </PageContainer>
  );
}
