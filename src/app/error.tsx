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
    // INTEGRATION POINT: forward to an error reporting service.
    console.error(error);
  }, [error]);

  return (
    <PageContainer className="pt-16">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="The screen could not be displayed. Try again, and let support know if it keeps happening."
        action={
          <Button variant="brand" size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </PageContainer>
  );
}
