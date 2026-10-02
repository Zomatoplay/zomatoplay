import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseSupportEmail, parseTelegramUsername, supportContact, telegramSupportUrl } from "./support";

describe("the Telegram support destination", () => {
  test("accepts a username in the forms an operator is likely to paste", () => {
    for (const raw of ["zomatoplay_support", "@zomatoplay_support", "https://t.me/zomatoplay_support", "t.me/zomatoplay_support/"]) {
      assert.equal(telegramSupportUrl(raw), "https://t.me/zomatoplay_support", raw);
    }
  });

  test("unset or malformed is null — never a broken or foreign link", () => {
    for (const raw of [undefined, "", "   ", "abc", "1starts_with_digit", "https://evil.example/x", "javascript:alert(1)", "name with space"]) {
      assert.equal(telegramSupportUrl(raw), null, String(raw));
    }
  });

  test("a link is only ever built on t.me", () => {
    assert.equal(parseTelegramUsername("https://telegram.me/Support_Desk"), "Support_Desk");
    assert.equal(telegramSupportUrl("https://example.com/Support_Desk"), null);
    assert.equal(telegramSupportUrl("https://t.me.evil.example/Support_Desk"), null);
  });

  test("nothing but the username survives — no path, query or fragment rides along", () => {
    for (const raw of ["https://t.me/Support_Desk?start=x", "https://t.me/Support_Desk/12", "https://t.me/Support_Desk#x", "t.me/+invitehash"]) {
      assert.equal(telegramSupportUrl(raw), null, raw);
    }
  });
});

describe("supportContact", () => {
  test("prefers the operator-configured Telegram account, opened externally", () => {
    assert.deepEqual(supportContact("https://t.me/example_support", "help@example.invalid"), {
      href: "https://t.me/example_support",
      external: true,
    });
  });

  test("falls back to the configured support mailbox", () => {
    assert.deepEqual(supportContact(null, "help@example.invalid"), {
      href: "mailto:help@example.invalid",
      external: false,
    });
  });

  test("links nowhere when nothing is configured", () => {
    assert.equal(supportContact(null, null), null);
  });
});

describe("the support email", () => {
  test("only an address-shaped value is accepted, and it is trimmed", () => {
    assert.equal(parseSupportEmail("  help@zomatoplay.com "), "help@zomatoplay.com");
    for (const raw of [undefined, null, "", "help", "a b@x.com", "<a@x.com>", "mailto:a@x.com", "a@b"]) {
      assert.equal(parseSupportEmail(raw), null, String(raw));
    }
  });
});
