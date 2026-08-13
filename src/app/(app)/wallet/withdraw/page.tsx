import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { WithdrawFlow } from "@/components/wallet/withdraw-flow";

export const metadata: Metadata = {
  title: "Withdraw",
  description: "Withdraw from your USDT balance to your bank account in INR.",
};

export default function WithdrawPage() {
  return (
    <>
      <PageHeader title="Withdraw" backHref="/wallet" />
      <PageContainer className="space-y-5">
        <WithdrawFlow />
      </PageContainer>
    </>
  );
}
