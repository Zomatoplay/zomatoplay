"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";

import { AdminPage } from "@/components/admin/layout/admin-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function AdminError({
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
    <AdminPage className="pt-16">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="This screen could not be displayed. Try again, and report it if it keeps happening."
        action={
          <Button variant="brand" size="sm" onClick={reset}>
            Try again
          </Button>
        }
      />
    </AdminPage>
  );
}
