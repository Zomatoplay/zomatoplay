import "server-only";

import { describeTronConfig, getTronConfig, isTronConfigured } from "../tron/config";

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
  network: "shasta" | "nile" | null;
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

const NETWORK_LABELS = {
  shasta: "Shasta testnet",
  nile: "Nile testnet",
} as const;

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
      isTestnet: true,
    };
  }

  // Validates on the way through: a misconfigured contract or address throws
  // here rather than being rendered as a deposit address that cannot receive.
  const described = describeTronConfig(getTronConfig());

  return {
    configured: true,
    network: described.network,
    networkLabel: NETWORK_LABELS[described.network],
    chain: "TRON",
    token: "USDT",
    tokenStandard: "TRC-20",
    contract: described.usdtContract,
    address: described.depositAddress,
    requiresConfirmation: described.requireConfirmation,
    // Mainnet is refused by `getTronConfig`, so anything that gets here is a
    // testnet. Stated as a field anyway rather than assumed by the component.
    isTestnet: true,
  };
}
