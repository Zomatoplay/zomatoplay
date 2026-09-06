import assert from "node:assert/strict";
import { test } from "node:test";

import { addressesEqual, isTronAddress, toHexAddress } from "./address";
import { getTronConfig, isTronConfigured, TronConfigError } from "./config";
import { parseTransfer } from "./parse";
import type { TronGridTransfer } from "./trongrid";

/**
 * TRON parsing and configuration, with no network access.
 *
 * These are the checks that decide whether an on-chain transfer becomes money
 * in someone's account, so they are tested against fixtures rather than against
 * a live chain: a test that needs Shasta to be up is a test that gets skipped.
 */

/* Real Shasta addresses. Public identifiers — nothing secret about them. */
const DEPOSIT = "TZ4UXDV5ZhNW7fb2AMSbgfAEZ7hWsnYS2g";
const CONTRACT = "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs";
const SENDER = "TVj7RNVHy6thbM7BWdSe9G6gXwKhjhdNZS";

function config() {
  process.env.TRON_NETWORK = "shasta";
  process.env.TRON_GRID_URL = "https://api.shasta.trongrid.io";
  process.env.TRON_USDT_CONTRACT = CONTRACT;
  process.env.TRON_PLATFORM_DEPOSIT_ADDRESS = DEPOSIT;
  return getTronConfig();
}

function transfer(overrides: Partial<TronGridTransfer> = {}): TronGridTransfer {
  return {
    transaction_id: "a".repeat(64),
    from: SENDER,
    to: DEPOSIT,
    value: "1500000",
    token_info: { symbol: "USDT", address: CONTRACT, decimals: 6 },
    block_timestamp: 1_760_000_000_000,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* Addresses                                                                   */
/* -------------------------------------------------------------------------- */

test("validates base58check, not just the shape", () => {
  assert.ok(isTronAddress(DEPOSIT));
  assert.ok(isTronAddress(CONTRACT));

  // Right length, right prefix, wrong checksum — the case a length check
  // would wave through into a deposit address that can never receive anything.
  const corrupted = DEPOSIT.slice(0, -1) + (DEPOSIT.endsWith("g") ? "h" : "g");
  assert.ok(!isTronAddress(corrupted));

  for (const bad of ["", "T", "0x0000000000000000000000000000000000000000", "not-an-address", DEPOSIT.slice(1)]) {
    assert.ok(!isTronAddress(bad), `${bad} should be rejected`);
  }
  assert.ok(!isTronAddress(null));
  assert.ok(!isTronAddress(42));
});

test("compares base58 and hex notations of the same address", () => {
  const hex = toHexAddress(DEPOSIT);
  assert.ok(hex && hex.startsWith("41"));
  assert.ok(addressesEqual(DEPOSIT, hex));
  assert.ok(addressesEqual(hex, DEPOSIT));
  assert.ok(addressesEqual(DEPOSIT, DEPOSIT));
  assert.ok(!addressesEqual(DEPOSIT, CONTRACT));
  assert.ok(!addressesEqual(DEPOSIT, null));
});

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

test("refuses mainnet outright", () => {
  config();
  process.env.TRON_NETWORK = "mainnet";
  assert.throws(() => getTronConfig(), TronConfigError);
  process.env.TRON_NETWORK = "shasta";
});

test("refuses a mistyped contract or deposit address", () => {
  config();
  process.env.TRON_USDT_CONTRACT = "TNotARealContractAddressAtAll11111";
  assert.throws(() => getTronConfig(), TronConfigError);

  config();
  process.env.TRON_PLATFORM_DEPOSIT_ADDRESS = "";
  assert.throws(() => getTronConfig(), TronConfigError);
  config();
});

test("refuses a plaintext TronGrid URL", () => {
  config();
  process.env.TRON_GRID_URL = "http://api.shasta.trongrid.io";
  assert.throws(() => getTronConfig(), TronConfigError);
  config();
});

test("refuses a deposit address that is the contract", () => {
  config();
  process.env.TRON_PLATFORM_DEPOSIT_ADDRESS = CONTRACT;
  assert.throws(() => getTronConfig(), TronConfigError);
  config();
});

test("confirmation is required unless explicitly disabled", () => {
  delete process.env.TRON_CONFIRMATION_REQUIRED;
  assert.equal(config().requireConfirmation, true);
  process.env.TRON_CONFIRMATION_REQUIRED = "true";
  assert.equal(config().requireConfirmation, true);
  process.env.TRON_CONFIRMATION_REQUIRED = "false";
  assert.equal(config().requireConfirmation, false);
  delete process.env.TRON_CONFIRMATION_REQUIRED;
});

test("reports whether TRON is configured at all", () => {
  config();
  assert.ok(isTronConfigured());
  delete process.env.TRON_USDT_CONTRACT;
  assert.ok(!isTronConfigured());
  config();
});

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

test("accepts a well-formed incoming USDT transfer", () => {
  const result = parseTransfer(transfer(), config(), DEPOSIT);
  assert.ok(result.ok);
  assert.equal(result.transfer.amount, "1.5");
  assert.equal(result.transfer.from, SENDER);
  assert.equal(result.transfer.to, DEPOSIT);
  assert.equal(result.transfer.tokenSymbol, "USDT");
  assert.ok(result.transfer.blockTimestamp instanceof Date);
});

test("ignores a different TRC-20 token", () => {
  // Anyone can deploy a token, name it USDT and send a million of it here.
  const result = parseTransfer(
    transfer({ token_info: { symbol: "USDT", address: SENDER, decimals: 6 } }),
    config(),
    DEPOSIT,
  );
  assert.ok(!result.ok);
  assert.equal(result.reason, "wrong_contract");
});

test("ignores a transfer to another address", () => {
  const result = parseTransfer(transfer({ to: SENDER }), config(), DEPOSIT);
  assert.ok(!result.ok);
  assert.equal(result.reason, "wrong_recipient");
});

test("ignores a self-transfer", () => {
  const result = parseTransfer(transfer({ from: DEPOSIT, to: DEPOSIT }), config(), DEPOSIT);
  assert.ok(!result.ok);
  assert.equal(result.reason, "outgoing");
});

test("refuses to guess the token's decimals", () => {
  // Six decimals on TRON, eighteen elsewhere. Assuming would scale every
  // amount by a factor of a million.
  const result = parseTransfer(
    transfer({ token_info: { symbol: "USDT", address: CONTRACT } }),
    config(),
    DEPOSIT,
  );
  assert.ok(!result.ok);
  assert.equal(result.reason, "missing_decimals");
});

test("scales by the decimals the token reports", () => {
  const six = parseTransfer(transfer({ value: "2500000" }), config(), DEPOSIT);
  assert.ok(six.ok);
  assert.equal(six.transfer.amount, "2.5");

  const eighteen = parseTransfer(
    transfer({
      value: "2500000000000000000",
      token_info: { symbol: "USDT", address: CONTRACT, decimals: 18 },
    }),
    config(),
    DEPOSIT,
  );
  assert.ok(eighteen.ok);
  assert.equal(eighteen.transfer.amount, "2.5");
});

test("rejects invalid or empty transaction data", () => {
  const cases: [Partial<TronGridTransfer>, string][] = [
    [{ transaction_id: undefined }, "missing_transaction_id"],
    [{ value: undefined }, "missing_amount"],
    [{ value: "0" }, "zero_amount"],
    [{ value: "not-a-number" }, "invalid_amount"],
    [{ from: "nonsense" }, "invalid_address"],
    [{ from: undefined }, "invalid_address"],
  ];

  for (const [override, reason] of cases) {
    const result = parseTransfer(transfer(override), config(), DEPOSIT);
    assert.ok(!result.ok, `${reason} should be rejected`);
    assert.equal(result.reason, reason);
  }
});

test("handles a transfer with no block timestamp", () => {
  const result = parseTransfer(transfer({ block_timestamp: undefined }), config(), DEPOSIT);
  assert.ok(result.ok);
  assert.equal(result.transfer.blockTimestamp, null);
});
