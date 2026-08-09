import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { SupportCenter } from "@/components/settings/support-center";

export const metadata: Metadata = {
  title: "Help centre",
};

export default function SupportPage() {
  return (
    <>
      <PageHeader title="Help centre" backHref="/settings" />
      <PageContainer>
        <SupportCenter />
      </PageContainer>
    </>
  );
}
