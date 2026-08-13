import Link from "next/link";
import { Compass } from "lucide-react";

import { AppShell, PageContainer } from "@/components/navigation/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

/**
 * Global 404. An unmatched URL belongs to no route group, so this renders
 * directly inside the root layout — it brings the user-app shell with it so an
 * unknown path still lands somewhere navigable. `/admin/*` has its own
 * `not-found.tsx` and never reaches this one.
 */
export default function NotFound() {
  return (
    <AppShell>
      <PageContainer className="pt-16">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="That screen does not exist, or it has moved."
          action={
            <Button asChild variant="brand" size="sm">
              <Link href="/">Back to Home</Link>
            </Button>
          }
        />
      </PageContainer>
    </AppShell>
  );
}
