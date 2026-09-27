import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { parseTelegramUsername, telegramSupportUrl } from "./support";

describe("the Telegram support destination", () => {
  test("accepts a username in the forms an operator is likely to paste", () => {
    for (const raw of ["nanotron_support", "@nanotron_support", "https://t.me/nanotron_support", "t.me/nanotron_support/"]) {
      assert.equal(telegramSupportUrl(raw), "https://t.me/nanotron_support", raw);
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
  });
});
