import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { NotificationSettings } from "@/components/settings/notification-settings";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function NotificationsPage() {
  return (
    <>
      <PageHeader title="Notifications" backHref="/settings" />
      <PageContainer>
        <NotificationSettings />
      </PageContainer>
    </>
  );
}
