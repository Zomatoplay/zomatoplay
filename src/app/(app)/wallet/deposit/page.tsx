import type { Metadata } from "next";

import { PageContainer } from "@/components/navigation/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { deferred } from "@/components/shared/section-boundary";
import { DepositNetworkSelect } from "@/components/wallet/deposit-network-select";
import { getMyDepositAddressAction } from "@/app/(app)/wallet/deposit/actions";
import { getPublicDepositNetwork } from "@/server/services/tron.service";

export const metadata: Metadata = {
  title: "Add funds",
  description: "Deposit USDT to your Nanotron balance.",
};

/**
 * Add funds.
 *
 * THE SHELL DOES NOT WAIT FOR THE DATABASE, AND THAT IS THE WHOLE CHANGE
 * ----------------------------------------------------------------------
 * This page used to `await getMyDepositAddressAction()` before returning any
 * HTML, so tapping "Add funds" showed the route's loading skeleton for the
 * whole lookup: one round trip when the account already has an address, four
 * on a first-ever allocation (pool sync, BEGIN, lookup, COMMIT — measured at
 * p50 1,087 ms), and longer still when the pool has to be swept first.
 *
 * None of that is needed to render the first thing a person sees. The network
 * choice, the "USDT (TRC-20) only, never TRX" warning and the Continue button
 * are constants, and the warning is precisely what should be read *before* an
 * address appears. So the read is started here — in the page's own wave, so it
 * is not delayed by a component further down the tree (CLAUDE.md §16.1a item
 * 6) — and handed down unawaited. Only the panel that shows the address
 * suspends.
 *
 * `getPublicDepositNetwork()` is deliberately separate and awaited: it reads
 * environment variables and validates an address locally, costs no round trip,
 * and answers the one question the first stage cannot get wrong — whether the
 * funds about to be sent are real.
 */
export default async function DepositPage() {
  // Resolved server-side, from the session — never from anything the client
  // supplies. See `getMyDepositAddressAction` for why.
  //
  // `deferred` marks the rejection handled so an early failure cannot surface
  // as an unhandled rejection before React consumes it; the promise itself is
  // unchanged and the component still sees whatever it settles to.
  const deposit = deferred(getMyDepositAddressAction());
  const network = getPublicDepositNetwork();

  return (
    <>
      <PageHeader title="Add funds" backHref="/wallet" />
      <PageContainer className="space-y-5">
        <DepositNetworkSelect
          deposit={deposit}
          isTestnet={network.isTestnet}
          networkLabel={network.label}
        />
      </PageContainer>
    </>
  );
}
