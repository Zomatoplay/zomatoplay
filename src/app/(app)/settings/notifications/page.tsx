import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationSettings } from "@/components/settings/notification-settings";

export const metadata: Metadata = {
  title: "Notifications",
};

export default async function NotificationsPage() {
  const slices = await getUserSlices(["notifications", "notificationPreferences"] as const);


  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Notifications" backHref="/settings" />
        <PageContainer>
          <NotificationSettings />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
