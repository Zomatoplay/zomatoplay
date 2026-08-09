import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { InvestmentsOverview } from "@/components/settings/investments-overview";

export const metadata: Metadata = {
  title: "Investments",
};

export default function InvestmentsPage() {
  return (
    <>
      <PageHeader title="Investments" backHref="/settings" />
      <PageContainer>
        <InvestmentsOverview />
      </PageContainer>
    </>
  );
}
