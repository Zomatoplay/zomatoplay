import "server-only";

import { fromTokenUnits, isPositive, type Decimal } from "@/db/money";

import { addressesEqual, isTronAddress } from "./address";
import type { TronConfig } from "./config";
import type { TronGridTransfer } from "./trongrid";

/**
 * Turning a TronGrid transfer into something worth crediting — or a reason not
 * to.
 *
 * Every rejection below is explicit and named. The alternative is a filter
 * chain that drops rows silently, which behaves identically whether it is
 * working or broken: no deposits appear either way. A named reason means the
 * inspect command can show *why* a transfer was skipped.
 */

export interface ParsedTransfer {
  txHash: string;
  from: string;
  to: string;
  contract: string;
  tokenSymbol: string | null;
  tokenDecimals: number;
  amount: Decimal;
  blockTimestamp: Date | null;
}

export type RejectionReason =
  | "missing_transaction_id"
  | "wrong_contract"
  | "wrong_recipient"
  | "outgoing"
  | "missing_amount"
  | "zero_amount"
  | "invalid_amount"
  | "missing_decimals"
  | "invalid_address";

export type ParseResult =
  | { ok: true; transfer: ParsedTransfer }
  | { ok: false; reason: RejectionReason; detail?: string };

/**
 * Decides whether one transfer is a deposit to this platform.
 *
 * The order matters only for the quality of the reason reported; every check
 * has to pass. Three of them are the ones that keep money safe:
 *
 * - **contract** — anyone can deploy a token, call it USDT and send a million
 *   of it to the deposit address for nothing. Only the configured contract
 *   counts.
 * - **recipient** — the listing is requested with `only_to`, but that is the
 *   server's promise rather than ours to keep. A transfer to any other address
 *   is not a deposit here.
 * - **direction** — `from == to` self-transfers and anything outgoing are not
 *   incoming money.
 *
 * `expectedRecipient` is passed explicitly rather than read from
 * `config.depositAddress`: the scanner now watches every address in the
 * deposit-address pool, one TronGrid query per address, so "the address this
 * particular page of transfers was requested for" is a parameter, not a
 * singleton.
 */
export function parseTransfer(
  raw: TronGridTransfer,
  config: TronConfig,
  expectedRecipient: string,
): ParseResult {
  const txHash = raw.transaction_id?.trim();
  if (!txHash) return { ok: false, reason: "missing_transaction_id" };

  const contract = raw.token_info?.address?.trim() ?? "";
  if (!addressesEqual(contract, config.usdtContract)) {
    return { ok: false, reason: "wrong_contract", detail: contract || "(none)" };
  }

  const to = raw.to?.trim() ?? "";
  if (!addressesEqual(to, expectedRecipient)) {
    return { ok: false, reason: "wrong_recipient", detail: to || "(none)" };
  }

  const from = raw.from?.trim() ?? "";
  if (!from || !isTronAddress(from)) {
    return { ok: false, reason: "invalid_address", detail: from || "(none)" };
  }
  if (addressesEqual(from, to)) {
    return { ok: false, reason: "outgoing", detail: "self-transfer" };
  }

  const decimals = raw.token_info?.decimals;
  if (typeof decimals !== "number" || !Number.isInteger(decimals)) {
    // Never assumed. TRC-20 USDT has six decimals on TRON and eighteen on some
    // other chains; guessing wrong scales every amount by a million.
    return { ok: false, reason: "missing_decimals" };
  }

  const value = raw.value?.trim();
  if (!value) return { ok: false, reason: "missing_amount" };

  let amount: Decimal;
  try {
    amount = fromTokenUnits(value, decimals);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_amount",
      detail: error instanceof Error ? error.message : undefined,
    };
  }

  if (!isPositive(amount)) return { ok: false, reason: "zero_amount" };

  return {
    ok: true,
    transfer: {
      txHash,
      from,
      to,
      contract,
      tokenSymbol: raw.token_info?.symbol ?? null,
      tokenDecimals: decimals,
      amount,
      blockTimestamp:
        typeof raw.block_timestamp === "number" && raw.block_timestamp > 0
          ? new Date(raw.block_timestamp)
          : null,
    },
  };
}

/** Human-readable rejection reasons, for the inspect command and the audit log. */
export const REJECTION_LABELS: Record<RejectionReason, string> = {
  missing_transaction_id: "no transaction id",
  wrong_contract: "different token contract",
  wrong_recipient: "sent to another address",
  outgoing: "not an incoming transfer",
  missing_amount: "no amount",
  zero_amount: "zero amount",
  invalid_amount: "unparseable amount",
  missing_decimals: "token decimals missing",
  invalid_address: "invalid sender address",
};
