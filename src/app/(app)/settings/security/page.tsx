import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { SecuritySettings } from "@/components/settings/security-settings";
import { getSecurityActivity } from "@/server/services/account.service";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { maskIndianMobile } from "@/lib/phone";

export const metadata: Metadata = {
  title: "Security",
};

export default async function SecurityPage() {
  const [activity, slices, account] = await Promise.all([
    getSecurityActivity(),
    getUserSlices(["profile"] as const),
    // Request-memoised: the layout's gate already resolved it.
    getAuthenticatedAccount(),
  ]);
  // A phone-signed-in customer has no password; the page must not offer to
  // change one.
  const signIn =
    account?.signInMethod === "phone"
      ? {
          method: "phone" as const,
          maskedPhone: account.phoneE164 ? maskIndianMobile(account.phoneE164) : null,
        }
      : { method: "email" as const, maskedPhone: null };

  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Security" backHref="/settings" />
        <PageContainer>
          <SecuritySettings activity={activity} signIn={signIn} />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
