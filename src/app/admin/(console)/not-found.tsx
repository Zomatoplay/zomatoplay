import Link from "next/link";
import { Compass } from "lucide-react";

import { AdminPage } from "@/components/admin/layout/admin-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

/**
 * 404 within the CRM. Overrides the root `not-found`, which would otherwise
 * drop an administrator into the user application's shell.
 */
export default function AdminNotFound() {
  return (
    <AdminPage className="pt-16">
      <EmptyState
        icon={Compass}
        title="Record not found"
        description="That record does not exist, or it has been removed."
        action={
          <Button asChild variant="brand" size="sm">
            <Link href="/admin">Back to dashboard</Link>
          </Button>
        }
      />
    </AdminPage>
  );
}
