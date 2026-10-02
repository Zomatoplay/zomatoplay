import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { WithdrawFlow } from "@/components/wallet/withdraw-flow";
import { getBankAccounts } from "@/server/services/account.service";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { getSupportEmail, getSupportTelegramUrl } from "@/server/services/catalogue.service";
import { getWithdrawalPasswordState } from "@/server/services/withdrawal-password.service";

export const metadata: Metadata = {
  title: "Withdraw",
  description: "Withdraw from your USDT balance to your bank account in INR.",
};

export default async function WithdrawPage() {
  const [bankAccounts, slices, account, telegramUrl, supportEmail] = await Promise.all([
    getBankAccounts(),
    getUserSlices(["profile", "balance"] as const),
    // Request-memoised: the layout's gate already resolved it.
    getAuthenticatedAccount(),
    getSupportTelegramUrl(),
    getSupportEmail(),
  ]);
  const withdrawalPassword = account
    ? await getWithdrawalPasswordState(account.userId)
    : { isSet: false, lockedUntil: null };


  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Withdraw" backHref="/wallet" />
        <PageContainer className="space-y-5">
          <WithdrawFlow
            bankAccounts={bankAccounts}
            withdrawalPassword={withdrawalPassword}
            telegramUrl={telegramUrl}
            supportEmail={supportEmail}
          />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
