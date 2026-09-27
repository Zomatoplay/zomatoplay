import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { signCustomerSession, verifyCustomerSession } from "./customer-session-token";

const SECRET = "a".repeat(48);
const NOW = 1_800_000_000;
const claims = { fid: "firebase-uid-1", ep: 0, iat: NOW, exp: NOW + 3600 };

describe("the customer session token", () => {
  test("round-trips while unexpired", () => {
    const token = signCustomerSession(claims, SECRET);
    assert.deepEqual(verifyCustomerSession(token, SECRET, NOW + 10), claims);
  });

  test("an expired session is not a session", () => {
    const token = signCustomerSession(claims, SECRET);
    assert.equal(verifyCustomerSession(token, SECRET, NOW + 3600), null);
  });

  test("a different secret, or any edited byte, is refused", () => {
    const token = signCustomerSession(claims, SECRET);
    assert.equal(verifyCustomerSession(token, "b".repeat(48), NOW), null);

    const [version, body, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, fid: "somebody-else" }),
      "utf8",
    ).toString("base64url");
    assert.equal(verifyCustomerSession(`${version}.${forged}.${signature}`, SECRET, NOW), null);
    assert.equal(verifyCustomerSession(`${version}.${body}.${signature.slice(0, -2)}AA`, SECRET, NOW), null);
  });

  test("garbage never throws", () => {
    for (const token of ["", "x", "v1..", "v1.e30.", "v2.a.b", "v1.%%%.b", "v1." + "a".repeat(5000) + ".b"]) {
      assert.equal(verifyCustomerSession(token, SECRET, NOW), null, token.slice(0, 20));
    }
  });

  test("a short secret is refused for signing and never verifies", () => {
    assert.throws(() => signCustomerSession(claims, "short"));
    assert.equal(verifyCustomerSession("v1.a.b", "short", NOW), null);
  });

  test("an issue time in the future (clock games) is refused", () => {
    const token = signCustomerSession({ ...claims, iat: NOW + 3600, exp: NOW + 7200 }, SECRET);
    assert.equal(verifyCustomerSession(token, SECRET, NOW), null);
  });
});
