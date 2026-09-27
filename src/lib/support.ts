/**
 * Where customers reach support on Telegram — the ONE place it is configured.
 *
 * `NEXT_PUBLIC_SUPPORT_TELEGRAM` holds a public Telegram username (`@name` or
 * `name`) or its `https://t.me/name` link. It is a public contact handle, so
 * `NEXT_PUBLIC_` is correct; nothing secret belongs in it.
 *
 * Unset or malformed returns `null`, and every caller renders a fallback
 * rather than a link: a support button that opens the wrong chat — or an
 * arbitrary URL somebody put in the variable — is worse than none. Only a
 * value shaped like a Telegram username ever becomes a link, and the link is
 * always built here, on `t.me`.
 */

/** Telegram's own rule: 5–32 characters, letters, digits and underscores, starting with a letter. */
const USERNAME = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

export function parseTelegramUsername(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let value = raw.trim();
  value = value.replace(/^https?:\/\//i, "").replace(/^(www\.)?(t\.me|telegram\.me)\//i, "");
  value = value.replace(/^@/, "").replace(/\/+$/, "");
  return USERNAME.test(value) ? value : null;
}

export function telegramSupportUrl(
  // Referenced literally so Next inlines it into the browser bundle.
  raw: string | undefined = process.env.NEXT_PUBLIC_SUPPORT_TELEGRAM,
): string | null {
  const username = parseTelegramUsername(raw);
  return username ? `https://t.me/${username}` : null;
}
