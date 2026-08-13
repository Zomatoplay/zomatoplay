import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { ProfileForm } from "@/components/settings/profile-form";

export const metadata: Metadata = {
  title: "Edit profile",
};

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="Edit profile" backHref="/settings" />
      <PageContainer>
        <ProfileForm />
      </PageContainer>
    </>
  );
}
