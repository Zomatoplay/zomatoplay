import "server-only";

import { isTronAddress } from "./address";

/**
 * TRON configuration, validated before anything uses it.
 *
 * MAINNET IS ENABLED, AND WHAT THAT COST
 * --------------------------------------
 * `TRON_NETWORK` accepts `mainnet`, `shasta` and `nile`. Mainnet used to throw
 * here, on the reasoning that crediting real money from an observed transfer
 * should be a reviewed code change rather than an environment variable someone
 * flips. That review has happened; the refusal is gone and two guarantees stand
 * in its place, because the failure mode is still not recoverable:
 *
 * - **The default is still a testnet.** `TRON_NETWORK` unset means `shasta`,
 *   never mainnet. A deployment reaches real money by naming it.
 * - **Mainnet may not skip finality.** `TRON_CONFIRMATION_REQUIRED=false` is a
 *   local-testing escape hatch (§18.3); on mainnet it is refused outright,
 *   because crediting before solidification means crediting money a re-org can
 *   take back. That is the one setting that turns this integration into a loss.
 *
 * Nothing else about the pipeline changes with the network. Address validation
 * is base58check and prefix-identical across TRON's networks (see `./address`),
 * the contract is configuration on every network, and the scanner scopes its
 * cursor and its address pool by `network` — so mainnet rows and testnet rows
 * never mix.
 *
 * THE API KEY IS SERVER-ONLY
 * --------------------------
 * `TRON_GRID_API_KEY` is read here, in a `server-only` module, and never
 * reaches a component. It is not prefixed `NEXT_PUBLIC_`, so Next will not
 * inline it into the browser bundle even by accident. Nothing in this file is
 * logged.
 */

export type TronNetwork = "mainnet" | "shasta" | "nile";

/**
 * How each network is named to a person.
 *
 * One map, so the deposit screen and the public projection can never disagree
 * about which chain somebody is being asked to send real money to. `mainnet`
 * carries no qualifier on purpose — "TRON Mainnet (live)" reads like a status
 * indicator, and the screens that use this already say plainly that funds are
 * real.
 */
export const TRON_NETWORK_LABELS: Record<TronNetwork, string> = {
  mainnet: "Mainnet",
  shasta: "Shasta testnet",
  nile: "Nile testnet",
};

export interface TronConfig {
  network: TronNetwork;
  gridUrl: string;
  apiKey: string | undefined;
  usdtContract: string;
  depositAddress: string;
  /**
   * The deposit-address pool: every address the scanner watches and
   * `getOrCreateDepositAddress` may hand out. Always includes `depositAddress`
   * — see the note above `TRON_DEPOSIT_POOL_ADDRESSES` below.
   */
  poolAddresses: string[];
  requireConfirmation: boolean;
  pollIntervalMs: number;
  /** How far back a poll looks when there is no cursor yet. */
  lookbackMs: number;
  /** Page size for TronGrid's transfer listing. */
  pageSize: number;
}

export class TronConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TronConfigError";
  }
}

const DEFAULT_GRID_URL: Record<TronNetwork, string> = {
  mainnet: "https://api.trongrid.io",
  shasta: "https://api.shasta.trongrid.io",
  nile: "https://nile.trongrid.io",
};

const TRON_NETWORKS = Object.keys(DEFAULT_GRID_URL) as TronNetwork[];

/** Whether TRON is configured at all. Everything else stays usable if not. */
export function isTronConfigured(): boolean {
  return Boolean(
    process.env.TRON_USDT_CONTRACT?.trim() &&
      (process.env.TRON_DEPOSIT_ADDRESS?.trim() ||
        process.env.TRON_PLATFORM_DEPOSIT_ADDRESS?.trim()),
  );
}

/**
 * Reads and validates the configuration.
 *
 * Every failure below is one that would otherwise surface as "no deposits are
 * being detected" days later, with nothing in the logs: a contract address with
 * a typo matches no transfer, and a deposit address with a typo receives
 * nothing. Failing loudly at the point of use is the whole purpose.
 */
export function getTronConfig(): TronConfig {
  // Unset means a testnet, deliberately. Reaching real money requires naming
  // the network — see the header.
  const network = (process.env.TRON_NETWORK ?? "shasta").trim().toLowerCase();

  if (!isTronNetwork(network)) {
    throw new TronConfigError(
      `TRON_NETWORK must be one of ${TRON_NETWORKS.join(", ")}, got ` +
        `${JSON.stringify(network)}.`,
    );
  }

  // Several spellings are accepted for each of the next few. `TRONGRID_*` /
  // `TRON_DEPOSIT_ADDRESS` are the names the deployment checklist uses;
  // `TRON_GRID_*` / `TRON_PLATFORM_DEPOSIT_ADDRESS` are what this code shipped
  // with; `TRON_GRID_API_URL` is the spelling the mainnet migration brief used.
  // Accepting all of them means a rename in one place does not silently
  // disable deposit detection in the other — the failure would look like "no
  // deposits arrived", because a wrong grid URL still answers.
  const gridUrl = (
    process.env.TRONGRID_API_URL ??
    process.env.TRON_GRID_API_URL ??
    process.env.TRON_GRID_URL ??
    DEFAULT_GRID_URL[network]
  ).trim();
  if (!/^https:\/\//.test(gridUrl)) {
    throw new TronConfigError(
      "TRON_GRID_URL must be an https URL. Chain data read over plaintext can " +
        "be rewritten in transit, and this decides who gets credited.",
    );
  }

  const usdtContract = process.env.TRON_USDT_CONTRACT?.trim() ?? "";
  if (!usdtContract) {
    throw new TronConfigError(
      "TRON_USDT_CONTRACT is not set. Without it every TRC-20 token sent to the " +
        "deposit address would look like a deposit.",
    );
  }
  if (!isTronAddress(usdtContract)) {
    throw new TronConfigError(
      "TRON_USDT_CONTRACT is not a valid TRON address (base58check failed).",
    );
  }

  const depositAddress = (
    process.env.TRON_DEPOSIT_ADDRESS?.trim() ||
    process.env.TRON_PLATFORM_DEPOSIT_ADDRESS?.trim() ||
    ""
  );
  if (!depositAddress) {
    throw new TronConfigError(
      "TRON_DEPOSIT_ADDRESS (or TRON_PLATFORM_DEPOSIT_ADDRESS) is not set.",
    );
  }
  if (!isTronAddress(depositAddress)) {
    throw new TronConfigError(
      "TRON_PLATFORM_DEPOSIT_ADDRESS is not a valid TRON address (base58check failed).",
    );
  }
  if (depositAddress === usdtContract) {
    throw new TronConfigError(
      "TRON_PLATFORM_DEPOSIT_ADDRESS and TRON_USDT_CONTRACT are the same address.",
    );
  }

  const poolAddresses = parsePoolAddresses(depositAddress);

  /**
   * Whether a transfer must be solidified before it can be credited.
   *
   * Defaults to on. A deposit credited before it is irreversible can be undone
   * by a re-org, and the money would be gone.
   *
   * `TRON_CONFIRMATIONS` is read as a count for compatibility with the
   * deployment checklist; anything above zero means "wait for finality". TRON's
   * model is solidification rather than a confirmation count, so the number
   * itself has no finer meaning here — see §18.3.
   */
  const requireConfirmation =
    process.env.TRON_CONFIRMATIONS !== undefined
      ? Number(process.env.TRON_CONFIRMATIONS) > 0
      : process.env.TRON_CONFIRMATION_REQUIRED !== "false";

  if (network === "mainnet" && !requireConfirmation) {
    // The escape hatch exists so a local test does not wait on solidification.
    // On mainnet that same setting credits real money a re-org can still take
    // back, and no test is worth that — so it is refused rather than warned
    // about. See the header.
    throw new TronConfigError(
      "Confirmation cannot be disabled on mainnet. Unset " +
        "TRON_CONFIRMATION_REQUIRED=false (or set TRON_CONFIRMATIONS to 1 or " +
        "more): crediting before a block is solidified credits money a re-org " +
        "can reverse.",
    );
  }

  return {
    network,
    gridUrl: gridUrl.replace(/\/+$/, ""),
    apiKey:
      process.env.TRONGRID_API_KEY?.trim() ||
      process.env.TRON_GRID_API_KEY?.trim() ||
      undefined,
    usdtContract,
    depositAddress,
    poolAddresses,
    requireConfirmation,
    pollIntervalMs: positiveInt(process.env.TRON_POLL_INTERVAL_MS, 30_000),
    lookbackMs: positiveInt(process.env.TRON_LOOKBACK_MS, 24 * 60 * 60 * 1000),
    pageSize: Math.min(positiveInt(process.env.TRON_PAGE_SIZE, 50), 200),
  };
}

function isTronNetwork(value: string): value is TronNetwork {
  return (TRON_NETWORKS as string[]).includes(value);
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/**
 * The deposit-address pool, from configuration.
 *
 * `TRON_DEPOSIT_POOL_ADDRESSES` is a comma-separated list of TRON addresses —
 * generated and controlled by the operator, outside this application. Nothing
 * here derives, generates or has ever seen a private key: see CLAUDE.md §18.8
 * for why address *derivation* is deliberately not implemented yet, and why
 * that is a decision rather than an oversight.
 *
 * The single legacy `TRON_DEPOSIT_ADDRESS` is always pool member zero, so the
 * feature works with the one address every deployment already has configured;
 * growing the pool is adding addresses to this variable, not a code change.
 * Each entry is validated the same way `TRON_DEPOSIT_ADDRESS` is — a typo here
 * would otherwise silently create a pool member that can never receive
 * anything — and duplicates (including the legacy address repeated) collapse
 * to one entry.
 */
function parsePoolAddresses(legacyDepositAddress: string): string[] {
  const raw = process.env.TRON_DEPOSIT_POOL_ADDRESSES?.trim();
  const configured = raw
    ? raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    : [];

  for (const address of configured) {
    if (!isTronAddress(address)) {
      throw new TronConfigError(
        `TRON_DEPOSIT_POOL_ADDRESSES contains an invalid TRON address: ` +
          `${JSON.stringify(address)}.`,
      );
    }
  }

  const pool = [legacyDepositAddress, ...configured];
  return Array.from(new Set(pool));
}

/** A public, secret-free summary, safe to render or log. */
export function describeTronConfig(config: TronConfig) {
  return {
    network: config.network,
    gridUrl: config.gridUrl,
    usdtContract: config.usdtContract,
    depositAddress: config.depositAddress,
    poolSize: config.poolAddresses.length,
    requireConfirmation: config.requireConfirmation,
    pollIntervalMs: config.pollIntervalMs,
    // Presence only. The value never leaves this process.
    apiKeyConfigured: config.apiKey !== undefined,
  };
}
