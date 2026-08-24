"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /*
     * The category is not available here.
     *
     * Next strips an error's message before it reaches a client boundary in
     * production, leaving only `digest`. Classification therefore happens on
     * the server (`@/server/errors`) and lands in `pipeline_events` with an
     * `errorCategory`; the digest below is what ties this screen to that row.
     *
     * INTEGRATION POINT: forward to an error reporting service.
     */
    console.error(error);
  }, [error]);

  return (
    <PageContainer className="pt-16">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="This screen could not be loaded. Nothing on your account was changed. Try again — and if it keeps happening, quote the reference below to support."
        action={
          <div className="space-y-3">
            <Button variant="brand" size="sm" onClick={reset}>
              Try again
            </Button>
            {error.digest ? (
              <p className="text-[11px] text-muted-foreground">
                Reference <span className="font-mono">{error.digest}</span>
              </p>
            ) : null}
          </div>
        }
      />
    </PageContainer>
  );
}
