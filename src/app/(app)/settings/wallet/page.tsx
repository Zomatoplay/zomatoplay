import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { WalletSettings } from "@/components/settings/wallet-settings";

export const metadata: Metadata = {
  title: "Wallet settings",
};

export default function WalletSettingsPage() {
  return (
    <>
      <PageHeader title="Wallet settings" backHref="/settings" />
      <PageContainer>
        <WalletSettings />
      </PageContainer>
    </>
  );
}
