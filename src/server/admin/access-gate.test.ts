import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { accessCodeMatches, isAccessGateConfigured, isAuthorizedAdminMobile } from "./access-gate";

const saved = { m: process.env.ADMIN_LOGIN_MOBILE, c: process.env.ADMIN_LOGIN_ACCESS_CODE };
afterEach(() => {
  for (const [key, value] of [["ADMIN_LOGIN_MOBILE", saved.m], ["ADMIN_LOGIN_ACCESS_CODE", saved.c]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("administrator access gate", () => {
  it("fails closed when nothing is configured", () => {
    delete process.env.ADMIN_LOGIN_MOBILE;
    delete process.env.ADMIN_LOGIN_ACCESS_CODE;
    assert.equal(isAccessGateConfigured(), false);
    assert.equal(isAuthorizedAdminMobile("+919876543210"), false);
    assert.equal(accessCodeMatches("Abcde12345"), false);
  });

  it("refuses a code that is not exactly ten letters and digits", () => {
    process.env.ADMIN_LOGIN_MOBILE = "9876543210";
    process.env.ADMIN_LOGIN_ACCESS_CODE = "short";
    assert.equal(isAccessGateConfigured(), false);
    process.env.ADMIN_LOGIN_ACCESS_CODE = "Abcde-2345";
    assert.equal(isAccessGateConfigured(), false);
  });

  it("matches the configured number in any spelling, and only that number", () => {
    process.env.ADMIN_LOGIN_MOBILE = "+91 98765 43210";
    process.env.ADMIN_LOGIN_ACCESS_CODE = "Abcde12345";
    assert.equal(isAccessGateConfigured(), true);
    assert.equal(isAuthorizedAdminMobile("+919876543210"), true);
    assert.equal(isAuthorizedAdminMobile("+919876543211"), false);
    assert.equal(isAuthorizedAdminMobile(null), false);
  });

  it("compares the code exactly, case-sensitively", () => {
    process.env.ADMIN_LOGIN_MOBILE = "9876543210";
    process.env.ADMIN_LOGIN_ACCESS_CODE = "Abcde12345";
    assert.equal(accessCodeMatches("Abcde12345"), true);
    assert.equal(accessCodeMatches(" Abcde12345 "), true);
    assert.equal(accessCodeMatches("abcde12345"), false);
    assert.equal(accessCodeMatches("Abcde1234"), false);
    assert.equal(accessCodeMatches(""), false);
  });
});
