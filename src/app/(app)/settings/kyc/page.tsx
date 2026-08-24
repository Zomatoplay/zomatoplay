import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { KycFlow } from "@/components/settings/kyc-flow";

export const metadata: Metadata = {
  title: "Identity verification",
};

export default async function KycPage() {
    const slices = await getUserSlices(["profile"] as const);

  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Identity verification" backHref="/settings" />
        <PageContainer className="space-y-5">
          <KycFlow />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
