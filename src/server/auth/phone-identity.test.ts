import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { decidePhoneLink, decidePhoneSignIn } from "./phone-identity";

/**
 * Who a verified phone number is allowed to reach.
 *
 * Every case here is a way somebody could end up inside another person's
 * account. None of them may resolve to "use" or "link" for the wrong account.
 */
describe("decidePhoneSignIn", () => {
  test("a known uid reaches its own account and only that", () => {
    assert.deepEqual(
      decidePhoneSignIn({ firebaseUid: "fb_a", byUid: { id: "usr_a" }, byPhone: null }),
      { action: "use", userId: "usr_a" },
    );
  });

  test("an unknown uid with an unused number creates a new account", () => {
    assert.deepEqual(
      decidePhoneSignIn({ firebaseUid: "fb_new", byUid: null, byPhone: null }),
      { action: "create" },
    );
  });

  test("a verified number held by another uid is refused, never re-pointed", () => {
    assert.deepEqual(
      decidePhoneSignIn({
        firebaseUid: "fb_attacker",
        byUid: null,
        byPhone: { id: "usr_victim", firebaseUid: "fb_victim" },
      }),
      { action: "refuse", reason: "phone_linked_to_other_account" },
    );
  });

  test("a verified number on an account with no uid is refused, not adopted", () => {
    assert.equal(
      decidePhoneSignIn({
        firebaseUid: "fb_x",
        byUid: null,
        byPhone: { id: "usr_repair", firebaseUid: null },
      }).action,
      "refuse",
    );
  });
});

describe("decidePhoneLink", () => {
  const account = { id: "usr_legacy", firebaseUid: null };

  test("links an unlinked account to an unused number", () => {
    assert.deepEqual(
      decidePhoneLink({ account, firebaseUid: "fb_1", byUid: null, byPhone: null }),
      { action: "link" },
    );
  });

  test("is idempotent for the same uid", () => {
    assert.deepEqual(
      decidePhoneLink({
        account: { id: "usr_legacy", firebaseUid: "fb_1" },
        firebaseUid: "fb_1",
        byUid: { id: "usr_legacy" },
        byPhone: { id: "usr_legacy", firebaseUid: "fb_1" },
      }),
      { action: "already_linked" },
    );
  });

  test("refuses a second, different number on an already-linked account", () => {
    assert.equal(
      decidePhoneLink({
        account: { id: "usr_legacy", firebaseUid: "fb_1" },
        firebaseUid: "fb_2",
        byUid: null,
        byPhone: null,
      }).action,
      "refuse",
    );
  });

  test("refuses a uid that already owns another account (no merging)", () => {
    assert.deepEqual(
      decidePhoneLink({
        account,
        firebaseUid: "fb_1",
        byUid: { id: "usr_new_phone_account" },
        byPhone: null,
      }),
      { action: "refuse", reason: "uid_linked_to_other_account" },
    );
  });

  test("refuses a number already verified on another account", () => {
    assert.deepEqual(
      decidePhoneLink({
        account,
        firebaseUid: "fb_1",
        byUid: null,
        byPhone: { id: "usr_other", firebaseUid: "fb_other" },
      }),
      { action: "refuse", reason: "phone_linked_to_other_account" },
    );
  });
});
