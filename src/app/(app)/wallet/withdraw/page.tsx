import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { WithdrawFlow } from "@/components/wallet/withdraw-flow";
import { getBankAccounts } from "@/server/services/account.service";

export const metadata: Metadata = {
  title: "Withdraw",
  description: "Withdraw from your USDT balance to your bank account in INR.",
};

export default async function WithdrawPage() {
  const [bankAccounts, slices] = await Promise.all([
    getBankAccounts(),
    getUserSlices(["profile", "balance"] as const),
  ]);


  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Withdraw" backHref="/wallet" />
        <PageContainer className="space-y-5">
          <WithdrawFlow bankAccounts={bankAccounts} />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
