import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { InvestmentDetail } from "@/components/settings/investment-detail";
import { getPlans } from "@/server/services/catalogue.service";

export const metadata: Metadata = {
  title: "Investment details",
};

export default async function InvestmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [plans, slices] = await Promise.all([
    getPlans(),
    getUserSlices(["investments"] as const),
  ]);


  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Investment details" backHref="/settings/investments" />
        <PageContainer>
          {/* Resolved client-side: allocations created during the session exist
              only in the in-memory store. */}
          <InvestmentDetail id={id} plans={plans} />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
