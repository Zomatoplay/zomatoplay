import Link from "next/link";
import { Compass } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
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
  );
}
