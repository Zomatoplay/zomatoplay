import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { InvestmentsOverview } from "@/components/settings/investments-overview";

export const metadata: Metadata = {
  title: "Investments",
};

export default async function InvestmentsPage() {
  const slices = await getUserSlices(["balance", "transactions", "investments"] as const);


  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Investments" backHref="/settings" />
        <PageContainer>
          <InvestmentsOverview />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
