import assert from "node:assert/strict";
import { test } from "node:test";

import { decideOperatorPhoneSignIn } from "./operator-phone";

const PHONE = "+919999900002";

test("an unknown number is not an operator", () => {
  assert.deepEqual(
    decideOperatorPhoneSignIn({ uid: "u1", phoneE164: PHONE, byUid: null, byPhone: null }),
    { action: "refuse", reason: "not_operator" },
  );
});

test("a provisioned number binds on the first verified sign-in", () => {
  assert.deepEqual(
    decideOperatorPhoneSignIn({
      uid: "u1",
      phoneE164: PHONE,
      byUid: null,
      byPhone: { id: "agt_1", firebaseUid: null, phoneE164: PHONE },
    }),
    { action: "bind", agentId: "agt_1" },
  );
});

test("a bound uid signs in as its operator", () => {
  const row = { id: "agt_1", firebaseUid: "u1", phoneE164: PHONE };
  assert.deepEqual(
    decideOperatorPhoneSignIn({ uid: "u1", phoneE164: PHONE, byUid: row, byPhone: row }),
    { action: "use", agentId: "agt_1" },
  );
});

test("a number already bound to another uid is never re-bound", () => {
  assert.deepEqual(
    decideOperatorPhoneSignIn({
      uid: "u2",
      phoneE164: PHONE,
      byUid: null,
      byPhone: { id: "agt_1", firebaseUid: "u1", phoneE164: PHONE },
    }),
    { action: "refuse", reason: "bound_elsewhere" },
  );
});

test("a uid whose operator now has a different number is refused", () => {
  assert.deepEqual(
    decideOperatorPhoneSignIn({
      uid: "u1",
      phoneE164: PHONE,
      byUid: { id: "agt_1", firebaseUid: "u1", phoneE164: "+919999900009" },
      byPhone: null,
    }),
    { action: "refuse", reason: "number_changed" },
  );
});
