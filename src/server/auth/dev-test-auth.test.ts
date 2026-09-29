import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { signCustomerSession, verifyCustomerSession } from "./customer-session-token";
import {
  devTestGateOpen,
  isLocalHost,
  issueDevChallenge,
  readDevTestCustomer,
  readDevTestOperator,
  sameSecret,
  verifyDevChallenge,
} from "./dev-test-auth";

const SECRET = "x".repeat(48);
const OPEN = { nodeEnv: "development", flag: "true", host: "localhost:3000", forwardedHost: null };

describe("the local test sign-in gate", () => {
  test("opens only for a dev build, an explicit flag and a local host", () => {
    assert.equal(devTestGateOpen(OPEN), true);
    for (const host of ["127.0.0.1:3000", "[::1]:3000", "localhost", "app.localhost:3000"]) {
      assert.equal(devTestGateOpen({ ...OPEN, host }), true, host);
    }
  });

  test("a production build never opens it, whatever else is set", () => {
    for (const nodeEnv of ["production", "test", undefined, "Development"]) {
      assert.equal(devTestGateOpen({ ...OPEN, nodeEnv }), false, String(nodeEnv));
    }
  });

  test("the flag must be exactly true", () => {
    for (const flag of [undefined, "", "1", "yes", "TRUE"]) {
      assert.equal(devTestGateOpen({ ...OPEN, flag }), false, String(flag));
    }
  });

  test("a public or look-alike host is refused", () => {
    for (const host of [
      "nanotron.app",
      "13.232.1.2:3000",
      "localhost.evil.example",
      "127.0.0.1.nip.io",
      "localhost:3000@evil.example",
      "[::2]:3000",
      "",
      null,
    ]) {
      assert.equal(devTestGateOpen({ ...OPEN, host }), false, String(host));
      assert.equal(isLocalHost(host), false, String(host));
    }
  });

  test("a proxy forwarding a public host closes it", () => {
    assert.equal(devTestGateOpen({ ...OPEN, forwardedHost: "nanotron.app" }), false);
    assert.equal(devTestGateOpen({ ...OPEN, forwardedHost: "localhost:3000" }), true);
  });
});

describe("the configured test identities", () => {
  test("customer: needs an Indian mobile number and a six-digit code", () => {
    assert.deepEqual(
      readDevTestCustomer({ DEV_TEST_CUSTOMER_PHONE: "99999 00001", DEV_TEST_CUSTOMER_OTP: "123456" }),
      { phoneE164: "+919999900001", code: "123456", ttlSeconds: 300 },
    );
    assert.equal(readDevTestCustomer({ DEV_TEST_CUSTOMER_PHONE: "99999 00001" }), null);
    assert.equal(readDevTestCustomer({ DEV_TEST_CUSTOMER_PHONE: "+15555550100", DEV_TEST_CUSTOMER_OTP: "123456" }), null);
    assert.equal(readDevTestCustomer({ DEV_TEST_CUSTOMER_PHONE: "9999900001", DEV_TEST_CUSTOMER_OTP: "1234" }), null);
  });

  test("operator: needs the dev admin credential and a six-digit code", () => {
    assert.equal(readDevTestOperator({ DEV_ADMIN_EMAIL: "a@b.c", DEV_ADMIN_PASSWORD: "p" }), null);
    assert.equal(
      readDevTestOperator({ DEV_ADMIN_EMAIL: "A@B.c", DEV_ADMIN_PASSWORD: "p", DEV_TEST_ADMIN_OTP: "654321" })?.email,
      "a@b.c",
    );
  });

  test("codes compare exactly", () => {
    assert.equal(sameSecret("123456", "123456"), true);
    assert.equal(sameSecret("123457", "123456"), false);
    assert.equal(sameSecret("12345", "123456"), false);
  });
});

describe("the code challenge", () => {
  const now = 1_800_000_000;

  test("valid for its subject until it expires", () => {
    const token = issueDevChallenge("+919999900001", SECRET, 300, now);
    assert.equal(verifyDevChallenge(token, "+919999900001", SECRET, now + 299), true);
    assert.equal(verifyDevChallenge(token, "+919999900001", SECRET, now + 300), false);
    assert.equal(verifyDevChallenge(token, "+919999900002", SECRET, now), false);
    assert.equal(verifyDevChallenge(token, "+919999900001", "y".repeat(48), now), false);
  });

  test("tampering or garbage is refused, never thrown", () => {
    const token = issueDevChallenge("s", SECRET, 300, now);
    const [body, sig] = token.split(".");
    for (const bad of [`${body}.${sig}x`, `${body}x.${sig}`, `${token}.extra`, "", "a.b", "..."]) {
      assert.equal(verifyDevChallenge(bad, "s", SECRET, now), false, bad);
    }
  });

  test("a challenge is not a session cookie, and a session cookie is not a challenge", () => {
    const challenge = issueDevChallenge("s", SECRET, 300, now);
    assert.equal(verifyCustomerSession(`v1.${challenge}`, SECRET, now), null);
    const session = signCustomerSession({ fid: "s", ep: 0, iat: now, exp: now + 300 }, SECRET);
    assert.equal(verifyDevChallenge(session.slice(3), "s", SECRET, now), false);
  });
});
