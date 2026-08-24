import type { Metadata } from "next";

import { UserDataProvider } from "@/lib/prototype-store";
import { getUserSlices } from "@/server/services/account.service";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { TransactionBrowser } from "@/components/wallet/transaction-browser";

export const metadata: Metadata = {
  title: "Transaction history",
};

export default async function TransactionsPage() {
  const slices = await getUserSlices(["transactions"] as const);


  return (
    <UserDataProvider data={slices}>
      <>
        <PageHeader title="Transaction history" backHref="/wallet" />
        <PageContainer className="space-y-4">
          <TransactionBrowser />
        </PageContainer>
      </>
  </UserDataProvider>
  );
}
