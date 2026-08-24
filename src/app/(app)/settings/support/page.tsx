import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { SupportCenter } from "@/components/settings/support-center";
import { getSupportTickets } from "@/server/services/account.service";

export const metadata: Metadata = {
  title: "Help centre",
};

export default async function SupportPage() {
  const tickets = await getSupportTickets();

  return (
    <>
      <PageHeader title="Help centre" backHref="/settings" />
      <PageContainer>
        <SupportCenter tickets={tickets} />
      </PageContainer>
    </>
  );
}
