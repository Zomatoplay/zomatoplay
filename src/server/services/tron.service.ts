import "server-only";

import {
  describeTronConfig,
  getTronConfig,
  isTronConfigured,
  TRON_NETWORK_LABELS,
  type TronNetwork,
} from "../tron/config";

/**
 * What the user application is allowed to know about the chain integration.
 *
 * A deliberate, hand-written projection rather than the config object itself.
 * `TronConfig` carries `apiKey`, and this value crosses into a client component
 * — so the safe thing is not to remember to strip the key, it is for the shape
 * that crosses the boundary to have no field to put it in.
 */
export interface PublicDepositTarget {
  configured: boolean;
  network: TronNetwork | null;
  networkLabel: string;
  chain: "TRON";
  token: "USDT";
  tokenStandard: "TRC-20";
  contract: string | null;
  address: string | null;
  requiresConfirmation: boolean;
  /** True while pointed at a testnet, so the UI can say so plainly. */
  isTestnet: boolean;
}

export async function getPublicDepositTarget(): Promise<PublicDepositTarget> {
  if (!isTronConfigured()) {
    return {
      configured: false,
      network: null,
      networkLabel: "Not configured",
      chain: "TRON",
      token: "USDT",
      tokenStandard: "TRC-20",
      contract: null,
      address: null,
      requiresConfirmation: true,
      // Nothing is configured, so nothing can be sent anywhere. Reported as a
      // testnet because that is the direction that cannot lose money by being
      // believed.
      isTestnet: true,
    };
  }

  // Validates on the way through: a misconfigured contract or address throws
  // here rather than being rendered as a deposit address that cannot receive.
  const described = describeTronConfig(getTronConfig());

  return {
    configured: true,
    network: described.network,
    networkLabel: TRON_NETWORK_LABELS[described.network],
    chain: "TRON",
    token: "USDT",
    tokenStandard: "TRC-20",
    contract: described.usdtContract,
    address: described.depositAddress,
    requiresConfirmation: described.requireConfirmation,
    // Derived, not assumed. This used to be a hard-coded `true` resting on
    // `getTronConfig` refusing mainnet; that refusal is gone, and a screen
    // telling somebody their real USDT is test funds is the worst sentence
    // this projection could produce.
    isTestnet: described.network !== "mainnet",
  };
}

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
