import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { SecuritySettings } from "@/components/settings/security-settings";
import { getSecurityActivity } from "@/server/services/account.service";

export const metadata: Metadata = {
  title: "Security",
};

export default async function SecurityPage() {
  const [activity, slices] = await Promise.all([
    getSecurityActivity(),
    getUserSlices(["profile"] as const),
  ]);

  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Security" backHref="/settings" />
        <PageContainer>
          <SecuritySettings activity={activity} />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
