import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { DepositNetworkSelect } from "@/components/wallet/deposit-network-select";
import { getMyDepositAddressAction } from "@/app/(app)/wallet/deposit/actions";

export const metadata: Metadata = {
  title: "Add funds",
  description: "Deposit USDT to your Nanotron balance.",
};

export default async function DepositPage() {
  // Resolved server-side, from the session — never from anything the client
  // supplies. See `getMyDepositAddressAction` for why. The network is whatever
  // this environment is configured for and comes back on the result, so the
  // screen never has to guess whether it is showing a mainnet address.
  //
  // Fetched eagerly so the address, its QR and its network label are already
  // on the page by the time the select stage advances to showing them; a
  // signed-out visitor (the route group's own layout gates that, but this
  // action re-checks anyway) gets a clear "not signed in" state instead.
  const deposit = await getMyDepositAddressAction();

  return (
    <>
      <PageHeader title="Add funds" backHref="/wallet" />
      <PageContainer className="space-y-5">
        <DepositNetworkSelect deposit={deposit} />
      </PageContainer>
    </>
  );
}
