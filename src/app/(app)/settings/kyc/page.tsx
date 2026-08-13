import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { KycFlow } from "@/components/settings/kyc-flow";

export const metadata: Metadata = {
  title: "Identity verification",
};

export default function KycPage() {
  return (
    <>
      <PageHeader title="Identity verification" backHref="/settings" />
      <PageContainer className="space-y-5">
        <KycFlow />
      </PageContainer>
    </>
  );
}
