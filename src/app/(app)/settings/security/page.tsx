import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { SecuritySettings } from "@/components/settings/security-settings";

export const metadata: Metadata = {
  title: "Security",
};

export default function SecurityPage() {
  return (
    <>
      <PageHeader title="Security" backHref="/settings" />
      <PageContainer>
        <SecuritySettings />
      </PageContainer>
    </>
  );
}
