import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  TICKET_BODY_MAX,
  TICKET_SUBJECT_MAX,
  isTicketCategory,
  messageRefusal,
  newTicketRefusal,
} from "./ticket-rules";

const valid = { category: "deposit", subject: "Deposit missing", message: "I sent 25 USDT an hour ago and it has not arrived." };

describe("a new support ticket", () => {
  test("a complete ticket is accepted", () => {
    assert.equal(newTicketRefusal(valid), null);
  });

  test("needs a known category", () => {
    for (const category of [undefined, "", "billing", 5, null]) {
      assert.notEqual(newTicketRefusal({ ...valid, category }), null, String(category));
    }
    assert.equal(isTicketCategory("withdrawal"), true);
    assert.equal(isTicketCategory("hacker"), false);
  });

  test("subject and message are trimmed and bounded", () => {
    assert.notEqual(newTicketRefusal({ ...valid, subject: "  hi " }), null);
    assert.notEqual(newTicketRefusal({ ...valid, subject: "x".repeat(TICKET_SUBJECT_MAX + 1) }), null);
    assert.notEqual(newTicketRefusal({ ...valid, message: "too short" }), null);
    assert.notEqual(newTicketRefusal({ ...valid, message: "y".repeat(TICKET_BODY_MAX + 1) }), null);
    assert.notEqual(newTicketRefusal({ ...valid, message: 12345 }), null);
  });
});

describe("a reply", () => {
  test("is bounded the same way", () => {
    assert.equal(messageRefusal("Thanks, that worked for me now."), null);
    assert.notEqual(messageRefusal("   "), null);
    assert.notEqual(messageRefusal("z".repeat(TICKET_BODY_MAX + 1)), null);
  });
});
