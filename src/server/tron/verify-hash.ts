import "server-only";

import type { TronConfig } from "./config";
import { parseTransfer, type ParsedTransfer } from "./parse";
import {
  fetchSolidBlockNumber,
  fetchTransactionBlock,
  fetchTrc20Transfers,
} from "./trongrid";

/**
 * Finding ONE transfer on the chain by the hash a customer submitted.
 *
 * REUSES THE SCANNER'S OWN PATH, DELIBERATELY
 * -------------------------------------------
 * Rather than decoding a raw transaction receipt, this reads the same TronGrid
 * TRC-20 listing the scanner reads — incoming transfers to the deposit address,
 * filtered to the configured contract — and runs each through the same
 * `parseTransfer`. So every rule that protects the scanner protects this path
 * too, with no second implementation to drift:
 *
 *  - only `TRON_USDT_CONTRACT` counts (a token *called* USDT does not);
 *  - the recipient must be the deposit address, checked locally;
 *  - self-transfers and outgoing transfers are refused;
 *  - token decimals come from the response, never assumed.
 *
 * Nothing the browser sent is used except the hash, as a search key. Amount,
 * sender, recipient, time and finality all come from the chain.
 *
 * A hash that is not in that listing — a different network, a different token,
 * a different recipient, a failed transaction, a typo, or a transfer from
 * before the request existed — is simply "not found". The customer is not told
 * which, and does not need to be: none of them can be credited from here.
 *
 * Finality is the scanner's rule too: the transaction's block must be at or
 * below the latest solidified block (CLAUDE.md §18.3), unless confirmation is
 * disabled — which `getTronConfig` refuses on mainnet.
 */

export type HashLookup =
  | { status: "not_found" }
  | {
      status: "found";
      transfer: ParsedTransfer;
      blockNumber: bigint | null;
      confirmed: boolean;
    };

/** Bounded: a busy address must not turn one button press into a crawl. */
const MAX_PAGES = 10;

export function normalizeTxHash(input: string): string | null {
  const value = input.trim().replace(/^0x/i, "").toLowerCase();
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}

export async function findTransferByHash(
  config: TronConfig,
  options: { txHash: string; recipient: string; sinceMs: number },
): Promise<HashLookup> {
  let pageUrl: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { transfers, nextUrl } = await fetchTrc20Transfers(config, {
      address: options.recipient,
      contract: config.usdtContract,
      minTimestamp: options.sinceMs > 0 ? options.sinceMs : undefined,
      pageUrl,
    });

    const raw = transfers.find(
      (entry) => entry.transaction_id?.trim().toLowerCase() === options.txHash,
    );
    if (raw) {
      const parsed = parseTransfer(raw, config, options.recipient);
      // In the listing but not a creditable transfer to this address: the same
      // answer as absent, for the same reason.
      if (!parsed.ok) return { status: "not_found" };

      const [block, solid] = await Promise.all([
        fetchTransactionBlock(config, parsed.transfer.txHash),
        config.requireConfirmation ? fetchSolidBlockNumber(config) : Promise.resolve(null),
      ]);
      const confirmed =
        !config.requireConfirmation ||
        (block !== null && solid !== null && block.blockNumber <= solid);

      return {
        status: "found",
        transfer: {
          ...parsed.transfer,
          blockTimestamp:
            parsed.transfer.blockTimestamp ??
            (block?.blockTimestamp ? new Date(block.blockTimestamp) : null),
        },
        blockNumber: block?.blockNumber ?? null,
        confirmed,
      };
    }

    if (!nextUrl) break;
    pageUrl = nextUrl;
  }

  return { status: "not_found" };
}
