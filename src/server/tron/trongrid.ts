import "server-only";

import { trackPipeline } from "../observability";
import type { TronConfig } from "./config";

/**
 * The TronGrid HTTP client.
 *
 * Read-only. It fetches transfer history and block heights and does nothing
 * else — no broadcasting, no signing, no key material anywhere near it.
 *
 * FAILURES ARE FAILURES
 * ---------------------
 * Every error path throws. None of them returns an empty list, because an empty
 * list is indistinguishable from "no deposits arrived", and a scanner that
 * treats a rate-limit response as "no deposits" would advance its cursor past
 * transfers it never saw. That is the one bug in this file that would lose
 * money quietly.
 */

export class TronGridError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "TronGridError";
  }
}

/** One TRC-20 transfer as TronGrid reports it. */
export interface TronGridTransfer {
  transaction_id: string;
  token_info?: { symbol?: string; address?: string; decimals?: number };
  block_timestamp?: number;
  from?: string;
  to?: string;
  type?: string;
  value?: string;
}

interface TransferPage {
  transfers: TronGridTransfer[];
  /** TronGrid's opaque cursor for the next page, when there is one. */
  nextUrl: string | null;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

async function request<T>(
  config: TronConfig,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  /*
   * Every TronGrid call is timed and recorded.
   *
   * The path label is the endpoint, never the full URL: a URL can carry query
   * parameters, and while this client sends the API key as a header
   * specifically so it cannot end up in one, a log that records whole URLs is
   * one refactor away from recording a key.
   */
  const endpoint = safeEndpointLabel(url);

  return trackPipeline(
    {
      pipeline: "chain_scanner",
      layer: "blockchain",
      operation: `trongrid.${endpoint}`,
      message: `TronGrid ${endpoint}`,
      metadata: { network: config.network, authenticated: Boolean(config.apiKey) },
    },
    () => performRequest<T>(config, url, init),
  );
}

/** The path only. Query strings are dropped rather than trusted. */
function safeEndpointLabel(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\/+/, "").slice(0, 60) || "request";
  } catch {
    return "request";
  }
}

async function performRequest<T>(
  config: TronConfig,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  // TronGrid allows unauthenticated calls at a low rate limit, so the key is
  // optional — but it is sent as a header, never a query parameter, so it does
  // not end up in a URL that gets logged.
  if (config.apiKey) headers.set("TRON-PRO-API-KEY", config.apiKey);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (cause) {
    // A network failure or timeout. Retryable, and emphatically not "no data".
    throw new TronGridError(
      `TronGrid request failed: ${cause instanceof Error ? cause.message : "unknown"}`,
      undefined,
      true,
    );
  }

  if (!response.ok) {
    throw new TronGridError(
      `TronGrid responded ${response.status}${
        response.status === 429 ? " (rate limited)" : ""
      }`,
      response.status,
      RETRYABLE_STATUS.has(response.status),
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TronGridError("TronGrid returned a body that is not JSON", 200, true);
  }

  if (body && typeof body === "object" && "Error" in body) {
    throw new TronGridError(`TronGrid error: ${String((body as { Error: unknown }).Error)}`);
  }

  return body as T;
}

/**
 * One page of TRC-20 transfers for an address.
 *
 * `only_to=true` asks TronGrid for incoming transfers only. The scanner filters
 * again on the recipient anyway — a server-side filter is a request for a
 * favour, not a guarantee, and this decides whether money is credited.
 */
export async function fetchTrc20Transfers(
  config: TronConfig,
  options: {
    address: string;
    contract: string;
    minTimestamp?: number;
    pageUrl?: string;
  },
): Promise<TransferPage> {
  const url =
    options.pageUrl ??
    (() => {
      const target = new URL(
        `${config.gridUrl}/v1/accounts/${options.address}/transactions/trc20`,
      );
      target.searchParams.set("only_to", "true");
      target.searchParams.set("limit", String(config.pageSize));
      target.searchParams.set("order_by", "block_timestamp,asc");
      target.searchParams.set("contract_address", options.contract);
      if (options.minTimestamp !== undefined) {
        target.searchParams.set("min_timestamp", String(options.minTimestamp));
      }
      return target.toString();
    })();

  const body = await request<{
    success?: boolean;
    data?: TronGridTransfer[];
    meta?: { links?: { next?: string } };
  }>(config, url);

  if (body.success === false) {
    throw new TronGridError("TronGrid reported the request as unsuccessful");
  }
  if (!Array.isArray(body.data)) {
    // A shape we do not recognise. Treating it as "no transfers" is exactly the
    // silent-success failure this client refuses to have.
    throw new TronGridError("TronGrid returned no `data` array");
  }

  return { transfers: body.data, nextUrl: body.meta?.links?.next ?? null };
}

/**
 * The height of the latest *solidified* block.
 *
 * Solidified means confirmed by a supermajority of super representatives and
 * no longer subject to re-org. Comparing a transfer's block against this is the
 * confirmation policy: below it, the transfer cannot be undone.
 */
export async function fetchSolidBlockNumber(config: TronConfig): Promise<bigint> {
  const body = await request<{ block_header?: { raw_data?: { number?: number } } }>(
    config,
    `${config.gridUrl}/walletsolidity/getnowblock`,
    { method: "POST" },
  );

  const number = body.block_header?.raw_data?.number;
  if (typeof number !== "number" || !Number.isFinite(number)) {
    throw new TronGridError("TronGrid returned no solidified block height");
  }
  return BigInt(number);
}

/** The height of the latest block, solidified or not. Used for reporting. */
export async function fetchHeadBlockNumber(config: TronConfig): Promise<bigint> {
  const body = await request<{ block_header?: { raw_data?: { number?: number } } }>(
    config,
    `${config.gridUrl}/wallet/getnowblock`,
    { method: "POST" },
  );
  const number = body.block_header?.raw_data?.number;
  if (typeof number !== "number") {
    throw new TronGridError("TronGrid returned no head block height");
  }
  return BigInt(number);
}

/**
 * The block a transaction landed in.
 *
 * The transfer listing does not carry a block number, only a timestamp, so this
 * is what makes the solidity comparison possible.
 */
export async function fetchTransactionBlock(
  config: TronConfig,
  txHash: string,
): Promise<{ blockNumber: bigint; blockTimestamp: number | null } | null> {
  const body = await request<{
    blockNumber?: number;
    blockTimeStamp?: number;
    id?: string;
  }>(config, `${config.gridUrl}/wallet/gettransactioninfobyid`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: txHash }),
  });

  // An empty object means TronGrid has not indexed it yet — a real answer,
  // distinct from an error, and the caller should wait rather than give up.
  if (!body || body.blockNumber === undefined) return null;

  return {
    blockNumber: BigInt(body.blockNumber),
    blockTimestamp: body.blockTimeStamp ?? null,
  };
}
