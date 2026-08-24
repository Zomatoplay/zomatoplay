import assert from "node:assert/strict";
import test from "node:test";

import { isProviderOutage } from "./session";

/**
 * "We could not check" must never be reported as "you are not signed in".
 *
 * This is the distinction behind the reported `NotAuthenticatedError: Not
 * signed in.` A transient failure to reach Supabase used to return null, which
 * every caller reads as an absent session — so a valid signed-in person was
 * redirected to `/login` mid-navigation.
 *
 * Getting this backwards is costly in both directions, which is why it is
 * pinned here rather than left to a comment:
 *
 * - an outage misread as "signed out" signs real users out during a blip;
 * - a bad token misread as "an outage" leaves an unauthenticated request
 *   showing a retry screen instead of the sign-in page.
 *
 * No database and no network: this is pure classification.
 */

test("a verdict about the token is not an outage", async (t) => {
  await t.test("4xx means the token was judged and rejected", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(
        isProviderOutage({ status, message: "invalid claim" }),
        false,
        `status ${status} is a verdict, so it means "not signed in"`,
      );
    }
  });
});

test("a failure to reach a verdict is an outage", async (t) => {
  await t.test("5xx means the provider broke, not the token", () => {
    for (const status of [500, 502, 503, 504]) {
      assert.equal(isProviderOutage({ status, message: "upstream" }), true, `${status}`);
    }
  });

  await t.test("a transport failure carries no status at all", () => {
    // undici's shape when the host is unreachable — the case measured at up to
    // 30.9s before it gave up, and previously reported as a signed-out user.
    assert.equal(isProviderOutage({ message: "fetch failed" }), true);
    assert.equal(isProviderOutage({ message: "request to ... failed, ECONNRESET" }), true);
    assert.equal(isProviderOutage({ message: "connect ETIMEDOUT 1.2.3.4:443" }), true);
    assert.equal(isProviderOutage({ message: "getaddrinfo EAI_AGAIN" }), true);
    assert.equal(isProviderOutage({ message: "The operation was aborted" }), true);
  });

  await t.test("no status is treated as an outage, not as a rejection", () => {
    // Failing closed here would sign valid users out during an outage, which is
    // precisely the bug. An unknown failure must mean "ask again shortly".
    assert.equal(isProviderOutage({ message: "something unexpected" }), true);
    assert.equal(isProviderOutage({}), true);
  });

  await t.test("a network message wins even with a 4xx attached", () => {
    // A transport failure that happens to carry a status is still a transport
    // failure; the message is the stronger signal.
    assert.equal(isProviderOutage({ status: 400, message: "fetch failed" }), true);
  });
});
