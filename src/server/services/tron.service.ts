import "server-only";

import {
  getTronConfig,
  isTronConfigured,
  TRON_NETWORK_LABELS,
  type TronNetwork,
} from "../tron/config";

/**
 * Which TRON network this deployment is on, and whether its funds are real.
 *
 * WHY IT IS SEPARATE FROM THE ADDRESS LOOKUP
 * ------------------------------------------
 * `/wallet/deposit` streams the address, so the first thing on screen renders
 * before any database read completes (see the page). But the first thing on
 * screen also has to say whether the USDT about to be sent is real, and that
 * sentence must not wait on a round trip, must not default while it waits, and
 * must not be inferred in the browser. Getting it backwards — telling somebody
 * their real USDT is test funds — is the worst thing that screen could print.
 *
 * So the network is answered from configuration alone: no database, no chain
 * call, no `await` that can fail. Synchronous for exactly that reason.
 *
 * Nothing sensitive crosses: a label and a boolean, with no field for a key or
 * an address, for the same reason `PublicDepositTarget` is hand-written.
 */
export function getPublicDepositNetwork(): {
  network: TronNetwork | null;
  label: string;
  isTestnet: boolean;
} {
  if (!isTronConfigured()) {
    return {
      network: null,
      label: "Not configured",
      // Nothing can be sent anywhere, and "testnet" is the direction that
      // cannot lose money by being believed.
      isTestnet: true,
    };
  }

  const config = getTronConfig();
  return {
    network: config.network,
    label: TRON_NETWORK_LABELS[config.network],
    isTestnet: config.network !== "mainnet",
  };
}
