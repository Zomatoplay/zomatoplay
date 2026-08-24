import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { WalletSettings } from "@/components/settings/wallet-settings";
import {
  getBankAccounts,
  getSavedWalletAddresses,
} from "@/server/services/account.service";
import { getDepositNetworks } from "@/server/services/catalogue.service";

export const metadata: Metadata = {
  title: "Wallet settings",
};

export default async function WalletSettingsPage() {
  const [walletAddresses, bankAccounts, networks] = await Promise.all([
    getSavedWalletAddresses(),
    getBankAccounts(),
    getDepositNetworks(),
  ]);

  return (
    <>
      <PageHeader title="Wallet settings" backHref="/settings" />
      <PageContainer>
        <WalletSettings
          walletAddresses={walletAddresses}
          bankAccounts={bankAccounts}
          networks={networks}
        />
      </PageContainer>
    </>
  );
}
