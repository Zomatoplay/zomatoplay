import assert from "node:assert/strict";
import { test } from "node:test";

import { withdrawalPasswordRefusal } from "./withdrawal-password-rules";

test("a reasonable password, typed twice, is accepted", () => {
  assert.equal(withdrawalPasswordRefusal("Withdraw2026", "Withdraw2026"), null);
  assert.equal(withdrawalPasswordRefusal("my secret 42 pass", "my secret 42 pass"), null);
});

test("the two entries must match", () => {
  assert.match(withdrawalPasswordRefusal("Withdraw2026", "Withdraw2027") ?? "", /do not match/);
});

test("weak or malformed passwords are refused", () => {
  assert.match(withdrawalPasswordRefusal("abc123", "abc123") ?? "", /at least 8/);
  assert.match(withdrawalPasswordRefusal("abcdefgh", "abcdefgh") ?? "", /letters and numbers/);
  assert.match(withdrawalPasswordRefusal("12345678", "12345678") ?? "", /letters and numbers/);
  assert.match(withdrawalPasswordRefusal(" Withdraw2026", " Withdraw2026") ?? "", /space/);
  assert.match(withdrawalPasswordRefusal("a".repeat(65) + "1", "a".repeat(65) + "1") ?? "", /at most 64/);
  assert.match(withdrawalPasswordRefusal(undefined, undefined) ?? "", /twice/);
});

test("the account's own mobile number is refused", () => {
  assert.match(
    withdrawalPasswordRefusal("pin9876543210", "pin9876543210", "+919876543210") ?? "",
    /mobile number/,
  );
  assert.equal(withdrawalPasswordRefusal("pin9876543210", "pin9876543210", "+919999900001"), null);
});
