import "server-only";

import { isTronAddress } from "./address";

/**
 * TRON configuration, validated before anything uses it.
 *
 * SHASTA ONLY
 * -----------
 * `TRON_NETWORK` accepts `shasta` and `nile`. Mainnet is refused: this
 * integration credits real balances from observed transfers and has never been
 * run against real money, and the failure mode of getting that wrong is not
 * recoverable. Enabling mainnet should be a deliberate change with its own
 * review, not an environment variable someone flips.
 *
 * THE API KEY IS SERVER-ONLY
 * --------------------------
 * `TRON_GRID_API_KEY` is read here, in a `server-only` module, and never
 * reaches a component. It is not prefixed `NEXT_PUBLIC_`, so Next will not
 * inline it into the browser bundle even by accident. Nothing in this file is
 * logged.
 */

export type TronNetwork = "shasta" | "nile";

export interface TronConfig {
  network: TronNetwork;
  gridUrl: string;
  apiKey: string | undefined;
  usdtContract: string;
  depositAddress: string;
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
  shasta: "https://api.shasta.trongrid.io",
  nile: "https://nile.trongrid.io",
};

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
  const network = (process.env.TRON_NETWORK ?? "shasta").trim().toLowerCase();

  if (network === "mainnet") {
    throw new TronConfigError(
      "TRON_NETWORK=mainnet is refused. This integration is testnet-only; " +
        "enabling mainnet is a code change, not a configuration change.",
    );
  }
  if (network !== "shasta" && network !== "nile") {
    throw new TronConfigError(
      `TRON_NETWORK must be "shasta" or "nile", got ${JSON.stringify(network)}.`,
    );
  }

  // Two spellings are accepted for each of the next few. `TRONGRID_*` /
  // `TRON_DEPOSIT_ADDRESS` are the names the deployment checklist uses;
  // `TRON_GRID_*` / `TRON_PLATFORM_DEPOSIT_ADDRESS` are what this code shipped
  // with. Accepting both means a rename in one place does not silently disable
  // deposit detection in the other.
  const gridUrl = (
    process.env.TRONGRID_API_URL ??
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

  return {
    network,
    gridUrl: gridUrl.replace(/\/+$/, ""),
    apiKey:
      process.env.TRONGRID_API_KEY?.trim() ||
      process.env.TRON_GRID_API_KEY?.trim() ||
      undefined,
    usdtContract,
    depositAddress,
    // Defaults to on. A deposit credited before it is irreversible can be
    // undone by a re-org, and the money would be gone.
    /**
     * `TRON_CONFIRMATIONS` is read as a count for compatibility with the
     * deployment checklist; anything above zero means "wait for finality".
     * TRON's model is solidification rather than a confirmation count, so the
     * number itself has no finer meaning here — see §18.3.
     */
    requireConfirmation:
      process.env.TRON_CONFIRMATIONS !== undefined
        ? Number(process.env.TRON_CONFIRMATIONS) > 0
        : process.env.TRON_CONFIRMATION_REQUIRED !== "false",
    pollIntervalMs: positiveInt(process.env.TRON_POLL_INTERVAL_MS, 30_000),
    lookbackMs: positiveInt(process.env.TRON_LOOKBACK_MS, 24 * 60 * 60 * 1000),
    pageSize: Math.min(positiveInt(process.env.TRON_PAGE_SIZE, 50), 200),
  };
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** A public, secret-free summary, safe to render or log. */
export function describeTronConfig(config: TronConfig) {
  return {
    network: config.network,
    gridUrl: config.gridUrl,
    usdtContract: config.usdtContract,
    depositAddress: config.depositAddress,
    requireConfirmation: config.requireConfirmation,
    pollIntervalMs: config.pollIntervalMs,
    // Presence only. The value never leaves this process.
    apiKeyConfigured: config.apiKey !== undefined,
  };
}
