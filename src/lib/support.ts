/**
 * Validation for the customer-support Telegram destination.
 *
 * The destination is configured by an operator in Admin → Settings → Customer
 * support and stored in `platform_settings.platform.supportTelegram` — the ONE
 * place it lives (read by `getSupportTelegramUrl()` in `catalogue.service`).
 * These helpers are the rule both sides apply: the admin action before it
 * writes, and the service again when it reads.
 *
 * An operator may type `@name`, `name` or `https://t.me/name`; only the bare
 * username is stored, and the link is always rebuilt here, on `t.me`. Anything
 * else — another host, a path, a query string, `javascript:` — is refused, so
 * the customer's support button can never be pointed at an arbitrary URL.
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

export function telegramSupportUrl(raw: string | undefined | null): string | null {
  const username = parseTelegramUsername(raw);
  return username ? `https://t.me/${username}` : null;
}

/**
 * Where a "Contact support" link points: the operator-configured Telegram
 * account (already validated to `t.me`), else the support mailbox, else
 * nowhere — never an invented destination.
 */
export function supportContact(
  telegramUrl: string | null,
  supportEmail: string | null,
): { href: string; external: boolean } | null {
  if (telegramUrl) return { href: telegramUrl, external: true };
  if (supportEmail) return { href: `mailto:${supportEmail}`, external: false };
  return null;
}
