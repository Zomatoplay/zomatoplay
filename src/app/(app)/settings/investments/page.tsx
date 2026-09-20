import { Suspense } from "react";
import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { ListSkeleton } from "@/components/shared/page-skeleton";
import { InvestmentsOverview } from "@/components/settings/investments-overview";

export const metadata: Metadata = {
  title: "Investments",
};

/**
 * The header and back link are known before any read, so they render first.
 *
 * This page reads three slices and rendered nothing — not even its own title
 * or its way back to Settings — until all three arrived (measured ~1,000ms).
 * A secondary screen that cannot be navigated away from while it loads is the
 * worst case for a back link, because the person is most likely to want it
 * precisely when the screen is slow.
 */
export default function InvestmentsPage() {
  return (
    <>
      <PageHeader title="Investments" backHref="/settings" />
      <PageContainer>
        <Suspense fallback={<ListSkeleton rows={4} />}>
          <InvestmentsSection />
        </Suspense>
      </PageContainer>
    </>
  );
}

async function InvestmentsSection() {
  const slices = await getUserSlices([
    "balance",
    "transactions",
    "investments",
  ] as const);

  return (
    <UserDataProvider data={slices}>
      <InvestmentsOverview />
    </UserDataProvider>
  );
}
