import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DISMISS_COOLDOWN_MS,
  EMPTY_INSTALL_STATE,
  isAppleMobileDevice,
  parseInstallState,
  recordDismissal,
  shouldOfferInstall,
} from "./pwa-install";

describe("when to offer installation", () => {
  const now = 1_800_000_000_000;

  test("never on the first sessions", () => {
    assert.equal(shouldOfferInstall({ ...EMPTY_INSTALL_STATE, sessions: 1 }, now), false);
    assert.equal(shouldOfferInstall({ ...EMPTY_INSTALL_STATE, sessions: 2 }, now), false);
    assert.equal(shouldOfferInstall({ ...EMPTY_INSTALL_STATE, sessions: 3 }, now), true);
  });

  test("never when already installed", () => {
    assert.equal(
      shouldOfferInstall({ ...EMPTY_INSTALL_STATE, sessions: 10, installed: true }, now),
      false,
    );
  });

  test("respects 'Not now' for the cooldown, then asks again — at most three times", () => {
    let state = { ...EMPTY_INSTALL_STATE, sessions: 5 };
    state = recordDismissal(state, now);
    assert.equal(shouldOfferInstall(state, now + 1000), false, "not straight back");
    assert.equal(shouldOfferInstall(state, now + DISMISS_COOLDOWN_MS - 1), false);
    assert.equal(shouldOfferInstall(state, now + DISMISS_COOLDOWN_MS), true);

    state = recordDismissal(recordDismissal(state, now), now);
    assert.equal(state.dismissals, 3);
    assert.equal(
      shouldOfferInstall(state, now + 10 * DISMISS_COOLDOWN_MS),
      false,
      "three dismissals and it stops asking for good",
    );
  });

  test("tolerates junk in storage", () => {
    assert.deepEqual(parseInstallState("not json"), EMPTY_INSTALL_STATE);
    assert.deepEqual(parseInstallState(null), EMPTY_INSTALL_STATE);
    assert.equal(parseInstallState('{"sessions":"x","installed":"yes"}').installed, false);
  });
});

describe("iPhone / iPad detection", () => {
  test("recognises iPhone and iPadOS-as-Mac, not a desktop Mac or Android", () => {
    assert.equal(
      isAppleMobileDevice({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15",
        maxTouchPoints: 5,
      }),
      true,
    );
    assert.equal(
      isAppleMobileDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
        maxTouchPoints: 5,
      }),
      true,
      "iPadOS reports as a Mac with touch",
    );
    assert.equal(
      isAppleMobileDevice({
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15",
        maxTouchPoints: 0,
      }),
      false,
    );
    assert.equal(
      isAppleMobileDevice({
        userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile",
        maxTouchPoints: 5,
      }),
      false,
    );
  });
});
