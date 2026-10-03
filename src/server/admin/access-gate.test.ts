import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { accessCodeMatches, isAccessGateConfigured, isAuthorizedAdminMobile } from "./access-gate";

const KEYS = ["ADMIN_LOGIN_ACCOUNTS", "ADMIN_LOGIN_MOBILE", "ADMIN_LOGIN_ACCESS_CODE"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});
function only(env: Partial<Record<(typeof KEYS)[number], string>>) {
  for (const key of KEYS) delete process.env[key];
  Object.assign(process.env, env);
}

const A = "+919876543210";
const B = "+919123456789";

describe("administrator access gate", () => {
  it("fails closed when nothing is configured", () => {
    only({});
    assert.equal(isAccessGateConfigured(), false);
    assert.equal(isAuthorizedAdminMobile(A), false);
    assert.equal(accessCodeMatches(A, "Abcde12345"), false);
  });

  it("refuses a code that is not exactly ten letters and digits", () => {
    only({ ADMIN_LOGIN_MOBILE: "9876543210", ADMIN_LOGIN_ACCESS_CODE: "short" });
    assert.equal(isAccessGateConfigured(), false);
    only({ ADMIN_LOGIN_ACCOUNTS: "9876543210:Abcde-2345" });
    assert.equal(isAccessGateConfigured(), false);
  });

  it("legacy single form: matches the number in any spelling, and only that number", () => {
    only({ ADMIN_LOGIN_MOBILE: "+91 98765 43210", ADMIN_LOGIN_ACCESS_CODE: "Abcde12345" });
    assert.equal(isAccessGateConfigured(), true);
    assert.equal(isAuthorizedAdminMobile(A), true);
    assert.equal(isAuthorizedAdminMobile("+919876543211"), false);
    assert.equal(isAuthorizedAdminMobile(null), false);
  });

  it("compares the code exactly, case-sensitively", () => {
    only({ ADMIN_LOGIN_MOBILE: "9876543210", ADMIN_LOGIN_ACCESS_CODE: "Abcde12345" });
    assert.equal(accessCodeMatches(A, "Abcde12345"), true);
    assert.equal(accessCodeMatches(A, " Abcde12345 "), true);
    assert.equal(accessCodeMatches(A, "abcde12345"), false);
    assert.equal(accessCodeMatches(A, "Abcde1234"), false);
    assert.equal(accessCodeMatches(A, ""), false);
  });

  it("several administrators, each with their own code — one code never opens another number", () => {
    only({ ADMIN_LOGIN_ACCOUNTS: "98765 43210:AdminA0001, +91-9123456789:AdminB0002" });
    assert.equal(isAuthorizedAdminMobile(A), true);
    assert.equal(isAuthorizedAdminMobile(B), true);
    assert.equal(accessCodeMatches(A, "AdminA0001"), true);
    assert.equal(accessCodeMatches(B, "AdminB0002"), true);
    assert.equal(accessCodeMatches(A, "AdminB0002"), false);
    assert.equal(accessCodeMatches(B, "AdminA0001"), false);
    assert.equal(accessCodeMatches("+919000000000", "AdminA0001"), false);
  });

  it("merges both forms, ignores malformed entries, and drops a number with two different codes", () => {
    only({
      ADMIN_LOGIN_ACCOUNTS: `${B}:AdminB0002,garbage,9000000000:bad,9876543210:Other00001`,
      ADMIN_LOGIN_MOBILE: "9876543210",
      ADMIN_LOGIN_ACCESS_CODE: "Abcde12345",
    });
    assert.equal(accessCodeMatches(B, "AdminB0002"), true);
    assert.equal(isAuthorizedAdminMobile("+919000000000"), false);
    // A is listed with two different codes: ambiguous, so neither is accepted.
    assert.equal(isAuthorizedAdminMobile(A), false);
    assert.equal(accessCodeMatches(A, "Abcde12345"), false);
    assert.equal(accessCodeMatches(A, "Other00001"), false);
  });

  it("removing an entry takes effect on the next call (read per call, no cache)", () => {
    only({ ADMIN_LOGIN_ACCOUNTS: `${A}:AdminA0001,${B}:AdminB0002` });
    assert.equal(isAuthorizedAdminMobile(B), true);
    process.env.ADMIN_LOGIN_ACCOUNTS = `${A}:AdminA0001`;
    assert.equal(isAuthorizedAdminMobile(B), false);
  });
});
