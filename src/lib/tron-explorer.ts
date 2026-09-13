import type { ChainNetwork } from "@/types/admin";

/**
 * Block explorer links.
 *
 * Safe to import from a client component: it builds URLs from public
 * identifiers and reads no configuration. Nothing here touches TronGrid or its
 * API key.
 */

const EXPLORERS: Record<ChainNetwork, string | null> = {
  shasta: "https://shasta.tronscan.org/#",
  nile: "https://nile.tronscan.org/#",
  // Live since the mainnet migration. This used to be null on the grounds that
  // the integration refused mainnet, so a link would imply support that did
  // not exist; it does now, and an operator crediting real money is exactly
  // who most needs to open the transfer on a block explorer and check it
  // against the row in front of them.
  mainnet: "https://tronscan.org/#",
};

export function transactionUrl(
  network: ChainNetwork,
  txHash: string,
): string | null {
  const base = EXPLORERS[network];
  // Seeded sample rows carry placeholder hashes; linking them would send an
  // operator to a "not found" page and make them doubt the real ones.
  if (!base || !/^[0-9a-f]{64}$/i.test(txHash)) return null;
  return `${base}/transaction/${txHash}`;
}

export function addressUrl(
  network: ChainNetwork,
  address: string,
): string | null {
  const base = EXPLORERS[network];
  if (!base || !address.startsWith("T")) return null;
  return `${base}/address/${address}`;
}

export const NETWORK_LABELS: Record<ChainNetwork, string> = {
  mainnet: "TRON Mainnet",
  shasta: "TRON Shasta (testnet)",
  nile: "TRON Nile (testnet)",
};
