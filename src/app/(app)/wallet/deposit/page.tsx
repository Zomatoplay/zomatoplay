import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { DepositFlow } from "@/components/wallet/deposit-flow";
import { TronDepositPanel } from "@/components/wallet/tron-deposit-panel";
import { generateQrSvgMap } from "@/lib/qr";
import { getDepositNetworks } from "@/server/services/catalogue.service";
import { getPublicDepositTarget } from "@/server/services/tron.service";
import type { DepositNetworkId } from "@/types";

export const metadata: Metadata = {
  title: "Add funds",
  description: "Deposit USDT to your Nanotron balance.",
};

export default async function DepositPage() {
  const [networks, tronTarget] = await Promise.all([
    getDepositNetworks(),
    getPublicDepositTarget(),
  ]);

  // QR codes are generated on the server so the QR library never reaches the
  // client bundle. All networks are rendered up-front because selection is
  // client-side state.
  const qrCodes = await generateQrSvgMap<DepositNetworkId>(
    networks.map((network) => ({
      key: network.id,
      value: network.address,
    })),
  );

  return (
    <>
      <PageHeader title="Add funds" backHref="/wallet" />
      <PageContainer className="space-y-5">
        {/* The live TRC-20 target, above the prototype flow: this is the one
            address that can actually receive anything. */}
        <TronDepositPanel target={tronTarget} />

        <DepositFlow networks={networks} qrCodes={qrCodes} />
      </PageContainer>
    </>
  );
}
