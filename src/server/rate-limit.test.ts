import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { resetRateLimits, takeToken } from "./rate-limit";

describe("the in-process rate limiter", () => {
  beforeEach(() => resetRateLimits());

  test("allows up to the limit in a window, then refuses until it resets", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i += 1) {
      assert.equal(takeToken("k", 3, 60_000, t0 + i).allowed, true);
    }
    const refused = takeToken("k", 3, 60_000, t0 + 10);
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAfterMs > 0);
    assert.equal(takeToken("k", 3, 60_000, t0 + 60_000).allowed, true, "a new window");
  });

  test("keys are independent — one account cannot exhaust another's", () => {
    assert.equal(takeToken("a", 1, 60_000, 0).allowed, true);
    assert.equal(takeToken("a", 1, 60_000, 1).allowed, false);
    assert.equal(takeToken("b", 1, 60_000, 1).allowed, true);
  });
});
