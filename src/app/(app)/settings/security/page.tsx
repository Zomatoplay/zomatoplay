import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { SecuritySettings } from "@/components/settings/security-settings";
import { WithdrawalPasswordSection } from "@/components/settings/withdrawal-password";
import { getSecurityActivity } from "@/server/services/account.service";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { maskIndianMobile } from "@/lib/phone";
import { localTestCustomer } from "@/server/auth/dev-test-gate";
import { getSupportTelegramUrl } from "@/server/services/catalogue.service";
import { getWithdrawalPasswordState } from "@/server/services/withdrawal-password.service";

export const metadata: Metadata = {
  title: "Security",
};

export default async function SecurityPage() {
  const [activity, slices, account, telegramUrl, localTest] = await Promise.all([
    getSecurityActivity(),
    getUserSlices(["profile"] as const),
    // Request-memoised: the layout's gate already resolved it.
    getAuthenticatedAccount(),
    getSupportTelegramUrl(),
    localTestCustomer(),
  ]);
  const withdrawalPassword = account
    ? await getWithdrawalPasswordState(account.userId)
    : { isSet: false, lockedUntil: null };
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
          <div className="space-y-5">
            <WithdrawalPasswordSection
              state={withdrawalPassword}
              phoneE164={account?.phoneE164 ?? null}
              telegramUrl={telegramUrl}
              localTest={
                localTest && localTest.phoneE164 === account?.phoneE164
                  ? { phoneE164: localTest.phoneE164 }
                  : null
              }
            />
            <SecuritySettings activity={activity} signIn={signIn} />
          </div>
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
