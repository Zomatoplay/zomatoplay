import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { ProfileForm } from "@/components/settings/profile-form";
import { isAvatarUploadAvailable } from "@/server/storage/avatar-store";

export const metadata: Metadata = {
  title: "Edit profile",
};

export default async function ProfilePage() {
    const slices = await getUserSlices(["profile"] as const);

  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Edit profile" backHref="/settings" />
        <PageContainer>
          <ProfileForm avatarUploadAvailable={isAvatarUploadAvailable()} />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
