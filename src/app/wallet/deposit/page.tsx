import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { DepositFlow } from "@/components/wallet/deposit-flow";
import { depositNetworks } from "@/data/transactions";
import { generateQrSvgMap } from "@/lib/qr";
import type { DepositNetworkId } from "@/types";

export const metadata: Metadata = {
  title: "Add funds",
  description: "Deposit USDT to your Nanotron balance.",
};

export default async function DepositPage() {
  // QR codes are generated on the server so the QR library never reaches the
  // client bundle. All networks are rendered up-front because selection is
  // client-side state.
  const qrCodes = await generateQrSvgMap<DepositNetworkId>(
    depositNetworks.map((network) => ({
      key: network.id,
      value: network.address,
    })),
  );

  return (
    <>
      <PageHeader title="Add funds" backHref="/wallet" />
      <PageContainer className="space-y-5">
        <DepositFlow qrCodes={qrCodes} />
      </PageContainer>
    </>
  );
}
