import "server-only";

import { createHash } from "node:crypto";

/**
 * TRON address handling.
 *
 * Implemented here rather than by adding `tronweb`: this needs base58check
 * decoding and a hex conversion, which is forty lines, against a dependency
 * that brings a full wallet, a signer and an HTTP client. Nothing in this
 * application signs anything — see the security rules in CLAUDE.md §17 — and a
 * library that *can* sign is a library that can be made to.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
/** Mainnet and every testnet share the 0x41 prefix; the network differs, not the format. */
const ADDRESS_PREFIX = 0x41;
const ADDRESS_BYTES = 21;

function base58Decode(value: string): Uint8Array | null {
  let big = BigInt(0);
  const base = BigInt(58);

  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) return null;
    big = big * base + BigInt(index);
  }

  const bytes: number[] = [];
  while (big > BigInt(0)) {
    bytes.unshift(Number(big % BigInt(256)));
    big = big / BigInt(256);
  }

  // Leading '1's are leading zero bytes, which the arithmetic above drops.
  for (const character of value) {
    if (character !== "1") break;
    bytes.unshift(0);
  }

  return Uint8Array.from(bytes);
}

const sha256 = (data: Uint8Array) =>
  Uint8Array.from(createHash("sha256").update(data).digest());

/**
 * Validates a base58check TRON address.
 *
 * The checksum is the point. A truncated or mistyped address usually still
 * *looks* like an address — 34 characters starting with T — and a length check
 * would pass it straight through to a deposit configuration that can never
 * receive anything. Verifying the checksum turns that into a startup error.
 */
export function isTronAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 26 || value.length > 40) {
    return false;
  }

  const decoded = base58Decode(value);
  if (!decoded || decoded.length !== ADDRESS_BYTES + 4) return false;
  if (decoded[0] !== ADDRESS_PREFIX) return false;

  const payload = decoded.slice(0, ADDRESS_BYTES);
  const checksum = decoded.slice(ADDRESS_BYTES);
  const expected = sha256(sha256(payload)).slice(0, 4);

  return checksum.every((byte, index) => byte === expected[index]);
}

/** Uppercase hex form (`41…`), which some TronGrid responses use. */
export function toHexAddress(base58: string): string | null {
  const decoded = base58Decode(base58);
  if (!decoded || decoded.length !== ADDRESS_BYTES + 4) return null;
  return Buffer.from(decoded.slice(0, ADDRESS_BYTES)).toString("hex").toUpperCase();
}

/**
 * Compares two addresses that may be in different notations.
 *
 * TronGrid is not consistent about this — the same address comes back base58
 * in one endpoint and hex in another — and a mismatched comparison would mean
 * either ignoring real deposits or, worse, accepting transfers sent somewhere
 * else entirely.
 */
export function addressesEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const normalise = (value: string) =>
    value.startsWith("T")
      ? toHexAddress(value)
      : value.replace(/^0x/i, "").toUpperCase();

  const left = normalise(a);
  const right = normalise(b);
  return left !== null && right !== null && left === right;
}
