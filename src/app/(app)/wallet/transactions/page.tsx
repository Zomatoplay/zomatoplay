import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { TransactionBrowser } from "@/components/wallet/transaction-browser";

export const metadata: Metadata = {
  title: "Transaction history",
};

export default function TransactionsPage() {
  return (
    <>
      <PageHeader title="Transaction history" backHref="/wallet" />
      <PageContainer className="space-y-4">
        <TransactionBrowser />
      </PageContainer>
    </>
  );
}
