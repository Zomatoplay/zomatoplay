import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { CompleteProfileForm } from "@/components/auth/complete-profile-form";
import { getAuthenticatedAccount } from "@/server/auth/account";

export const metadata: Metadata = { title: "Complete your profile" };

export default async function CompleteProfilePage() {
  const account = await getAuthenticatedAccount();
  if (!account) redirect("/login");
  if (account.profileComplete) redirect("/");

  return (
    <CompleteProfileForm
      email={account.email}
      initialFullName={account.fullName}
    />
  );
}
