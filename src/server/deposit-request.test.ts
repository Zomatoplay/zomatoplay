import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decimal } from "@/db/money";

import { newDepositRequestId, pickExpectedAmount } from "./services/deposit-requests.service";
import { normalizeTxHash } from "./tron/verify-hash";

/**
 * The pure halves of the deposit-request design — no database, no chain.
 */
describe("deposit request ids", () => {
  test("are DEP- plus eight characters, and can never be mistaken for a hash", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = newDepositRequestId();
      assert.match(id, /^DEP-[0-9A-HJKMNP-TV-Z]{8}$/);
      assert.equal(normalizeTxHash(id), null, "a request id is not a transaction hash");
      seen.add(id);
    }
    assert.equal(seen.size, 500);
  });
});

describe("the exact amount to send", () => {
  test("is the requested amount plus 0.01–0.99, never an amount already taken", () => {
    const requested = decimal("100");
    const taken = new Set<string>();
    for (let i = 0; i < 99; i += 1) {
      const amount = pickExpectedAmount(requested, taken);
      assert.ok(amount, `slot ${i} available`);
      assert.ok(!taken.has(amount), "never reuses an open amount");
      assert.match(amount, /^100\.\d{1,2}$/);
      const offset = Number(amount) - 100;
      assert.ok(offset >= 0.01 && offset <= 0.99);
      taken.add(amount);
    }
    assert.equal(pickExpectedAmount(requested, taken), null, "exhaustion is refused, not wrapped");
  });

  test("uses exact decimal arithmetic", () => {
    const amount = pickExpectedAmount(decimal("0.1"), new Set());
    assert.ok(amount);
    // 0.1 + 0.2 in floating point is 0.30000000000000004; here it never is.
    assert.match(amount, /^(0|1)(\.\d{1,2})?$/);
  });
});

describe("transaction hash normalisation", () => {
  test("accepts 64 hex characters, with or without 0x, in any case", () => {
    const hash = "A".repeat(64);
    assert.equal(normalizeTxHash(hash), "a".repeat(64));
    assert.equal(normalizeTxHash(`0x${hash}`), "a".repeat(64));
    assert.equal(normalizeTxHash(`  ${hash}  `), "a".repeat(64));
  });

  test("refuses anything else", () => {
    for (const input of ["", "abc", "g".repeat(64), "a".repeat(63), "a".repeat(65), "DEP-ABCDEFGH"]) {
      assert.equal(normalizeTxHash(input), null, input);
    }
  });
});
