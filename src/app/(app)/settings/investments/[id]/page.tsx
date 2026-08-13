import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { InvestmentDetail } from "@/components/settings/investment-detail";

export const metadata: Metadata = {
  title: "Investment details",
};

export default async function InvestmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <>
      <PageHeader title="Investment details" backHref="/settings/investments" />
      <PageContainer>
        {/* Resolved client-side: allocations created during the session exist
            only in the in-memory store. */}
        <InvestmentDetail id={id} />
      </PageContainer>
    </>
  );
}
