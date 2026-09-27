import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { Card } from "@/components/ui/card";
import { DepositFlow } from "@/components/wallet/deposit-flow";
import { generateQrSvg } from "@/lib/qr";
import { requireCurrentUserIdForPage } from "@/server/current-user";
import { getDepositNetworks } from "@/server/services/catalogue.service";
import { listOwnDepositRequests } from "@/server/services/deposit-requests.service";
import { getActiveDepositAddress } from "@/server/services/deposit-settings.service";
import { getPublicDepositNetwork } from "@/server/services/tron.service";

export const metadata: Metadata = {
  title: "Add funds",
  description: "Deposit USDT to your Nanotron balance.",
};

/**
 * Add funds: one configured address, a deposit request, and a transaction hash.
 *
 * Everything this page shows is resolved server-side: the address from the
 * operator's configuration (never from the browser, never hard-coded), the
 * account from the session, and the caller's own most recent request — still
 * open, or recently resolved, so a person who comes back mid-deposit lands on
 * it rather than on a blank form. Three reads in one wave (CLAUDE.md §16.1a).
 */
export default async function DepositPage() {
  const userId = await requireCurrentUserIdForPage();
  const network = getPublicDepositNetwork();

  const [active, requests, networks] = await Promise.all([
    getActiveDepositAddress(),
    listOwnDepositRequests(userId, 3),
    getDepositNetworks(),
  ]);

  const current =
    requests.find((request) =>
      ["awaiting_payment", "verifying", "needs_review"].includes(request.status),
    ) ?? null;
  const qrSvg = current ? await generateQrSvg(current.receivingAddress) : null;
  const minimumDeposit = networks.find((entry) => entry.id === "trc20")?.minDeposit ?? 10;

  return (
    <>
      <PageHeader title="Add funds" backHref="/wallet" />
      <PageContainer className="space-y-5">
        {active || current ? (
          <DepositFlow
            chainLabel={`TRON ${network.label}`}
            isTestnet={network.isTestnet}
            minimumDeposit={minimumDeposit}
            initialRequest={current}
            initialQrSvg={qrSvg}
          />
        ) : (
          <Card className="p-5">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <div className="min-w-0 space-y-1">
                <h2 className="text-sm font-semibold">Deposits are not available right now</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  No deposit address is configured. Please try again later or contact support.
                </p>
              </div>
            </div>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
