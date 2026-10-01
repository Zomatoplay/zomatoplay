import assert from "node:assert/strict";
import { test } from "node:test";

import { hashPassword, verifyPassword } from "./password-hash";

test("a hash verifies its own password and nothing else", async () => {
  const stored = await hashPassword("Withdraw2026");
  assert.equal(await verifyPassword("Withdraw2026", stored), true);
  assert.equal(await verifyPassword("withdraw2026", stored), false, "case matters");
  assert.equal(await verifyPassword("Withdraw2026 ", stored), false);
  assert.equal(await verifyPassword("", stored), false);
});

test("the plaintext never appears in the stored value, and salts differ", async () => {
  const a = await hashPassword("SamePassword1");
  const b = await hashPassword("SamePassword1");
  assert.ok(!a.includes("SamePassword1"));
  assert.notEqual(a, b, "a fresh salt each time");
  assert.match(a, /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
});

test("malformed or tampered hashes refuse rather than throw", async () => {
  const stored = await hashPassword("Correct1234");
  const [, , , , salt, key] = stored.split("$");
  for (const bad of [
    "",
    "plaintext",
    "bcrypt$2b$10$abc",
    `scrypt$32768$8$1$${salt}`,
    `scrypt$1073741824$8$1$${salt}$${key}`, // a huge N must not be attempted
    `scrypt$32769$8$1$${salt}$${key}`, // not a power of two
    `scrypt$32768$8$1$${salt}$AAAA`,
  ]) {
    assert.equal(await verifyPassword("Correct1234", bad), false, bad);
  }
});

test("equivalent Unicode forms are the same password", async () => {
  const stored = await hashPassword("Café2026x");
  assert.equal(await verifyPassword("Café2026x", stored), true);
});
