import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CompleteProfileForm } from "@/components/auth/complete-profile-form";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { isAvatarUploadAvailable, signAvatarUrl } from "@/server/storage/avatar-store";
import { maskIndianMobile } from "@/lib/phone";

export const metadata: Metadata = { title: "Set up your profile" };

export default async function CompleteProfilePage() {
  const account = await getAuthenticatedAccount();
  if (!account) redirect("/login");
  if (account.profileComplete) redirect("/");

  return (
    <CompleteProfileForm
      signedInAs={
        account.phoneE164 ? maskIndianMobile(account.phoneE164) : account.email
      }
      phoneVerified={account.phoneE164 !== null}
      initialFullName={account.fullName}
      initialGender={account.gender}
      initialEmail={account.email}
      avatarUploadAvailable={isAvatarUploadAvailable()}
      initialAvatarUrl={await signAvatarUrl(account.avatarStorageKey)}
    />
  );
}
