import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isIdempotencyKey,
  ManualCreditError,
  MAX_MANUAL_CREDIT_USDT,
  normalizeCreditNote,
  normalizeCustomerId,
  parseManualCreditAmount,
} from "./manual-credit.service";

function refuses(run: () => unknown, pattern: RegExp) {
  assert.throws(run, (error: Error) => {
    assert.ok(error instanceof ManualCreditError, `expected ManualCreditError, got ${error.name}`);
    assert.match(error.message, pattern);
    return true;
  });
}

describe("manual credit amount", () => {
  test("a positive USDT amount is accepted exactly", () => {
    assert.equal(parseManualCreditAmount("25"), "25");
    assert.equal(parseManualCreditAmount(" 10.5 "), "10.5");
    assert.equal(parseManualCreditAmount("0.000001"), "0.000001");
    assert.equal(parseManualCreditAmount("1,250.75"), "1250.75");
    assert.equal(parseManualCreditAmount(MAX_MANUAL_CREDIT_USDT), MAX_MANUAL_CREDIT_USDT);
  });

  test("zero is refused", () => {
    refuses(() => parseManualCreditAmount("0"), /greater than zero/);
    refuses(() => parseManualCreditAmount("0.000000"), /greater than zero/);
  });

  test("a negative amount is refused — this can never debit", () => {
    refuses(() => parseManualCreditAmount("-5"), /greater than zero/);
  });

  test("anything that is not an exact decimal is refused", () => {
    for (const raw of ["", "abc", "1e3", "NaN", "Infinity", "12.", ".5", "0x10", "1 000"]) {
      refuses(() => parseManualCreditAmount(raw), /valid USDT amount|Enter an amount/);
    }
    // Not a string at all — a forged request body.
    refuses(() => parseManualCreditAmount(25), /Enter an amount/);
    refuses(() => parseManualCreditAmount(null), /Enter an amount/);
  });

  test("more precision than USDT carries is refused, not rounded", () => {
    refuses(() => parseManualCreditAmount("1.0000001"), /six decimal places|6 decimal places/);
  });

  test("a typo-sized amount above the per-credit ceiling is refused", () => {
    refuses(() => parseManualCreditAmount("100000.01"), /limited to/);
    refuses(() => parseManualCreditAmount("1000000"), /limited to/);
  });
});

describe("customer id", () => {
  test("member ids and account ids are accepted", () => {
    assert.equal(normalizeCustomerId("NT-1234567"), "NT-1234567");
    assert.equal(normalizeCustomerId(" nt-1234567 "), "NT-1234567");
    assert.equal(normalizeCustomerId("usr_8c41a2"), "usr_8c41a2");
  });

  test("anything else never reaches a query", () => {
    for (const raw of ["", "NT-123", "NT-12345678", "1234567", "usr_", "usr_x'; drop table users;--", "%", 42, null]) {
      assert.equal(normalizeCustomerId(raw), null, String(raw));
    }
  });
});

describe("idempotency key and note", () => {
  test("only a v4 UUID is a key", () => {
    assert.equal(isIdempotencyKey("3b241101-e2bb-4255-8caf-4136c566a962"), true);
    assert.equal(isIdempotencyKey("3b241101-e2bb-1255-8caf-4136c566a962"), false, "not v4");
    assert.equal(isIdempotencyKey("retry"), false);
    assert.equal(isIdempotencyKey(undefined), false);
  });

  test("the note is trimmed, emptied to null and bounded", () => {
    assert.equal(normalizeCreditNote("  short deposit DEP-1  "), "short deposit DEP-1");
    assert.equal(normalizeCreditNote("   "), null);
    assert.equal(normalizeCreditNote(undefined), null);
    assert.equal(normalizeCreditNote("line\nbreak"), "line break");
    refuses(() => normalizeCreditNote("x".repeat(501)), /limited to 500/);
  });
});
