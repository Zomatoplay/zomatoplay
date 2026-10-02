/**
 * Application-wide constants.
 *
 * Values that will later come from a backend, a rates provider or a CMS are
 * marked so they are easy to find.
 */

/**
 * The public product name — the one place it is written. Every customer- and
 * operator-facing string (titles, metadata, the PWA manifest, the install
 * prompt, share text) reads it from here, so a rebrand is this line plus the
 * icon in `@/lib/pwa-icon`. The repository, infrastructure and internal
 * identifiers (cookie names, cache keys) deliberately do not follow it.
 */
export const APP_NAME = "Zomato Play";
export const APP_TAGLINE = "Investment Platform";
export const APP_DESCRIPTION = `${APP_NAME} is a mobile-first investment platform: fund your account in USDT, invest in managed plans, track rewards and refer friends.`;

/**
 * The public origin: `NEXT_PUBLIC_SITE_URL` when a deployment names one, else
 * the production domain. The one place the production domain is written —
 * referral links and absolute metadata URLs both read it, so neither can fall
 * back to a hosting provider's hostname.
 */
export const PUBLIC_ORIGIN = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://zomatoplay.com"
).replace(/\/+$/, "");

/**
 * Where a referral link points.
 *
 * `/login?ref=CODE`: customers register by mobile number on `/login`, so the
 * link lands on the form that creates the account. The middleware captures
 * `?ref=` on any route into the cookie that decides attribution at account
 * creation (`resolveReferrer`); the query is only the carrier.
 *
 * INTEGRATION POINT: set `NEXT_PUBLIC_SITE_URL` to the public origin in every
 * deployment — it is set to `https://zomatoplay.com` in production. Without
 * it a link copied out of the app falls back to the production domain below,
 * never to the hosting provider's own hostname.
 */
export const REFERRAL_BASE_URL = `${PUBLIC_ORIGIN}/login`;

/**
 * The support mailbox, or null when the deployment has not named one.
 *
 * Configuration rather than a constant, for the same reason the Telegram
 * contact is: an address printed in source is an address somebody has to
 * remember to own, and a support email nobody reads is worse than none.
 * `NEXT_PUBLIC_SUPPORT_EMAIL`; anything that is not address-shaped is ignored.
 */
export const SUPPORT_EMAIL: string | null = (() => {
  const value = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() ?? "";
  return /^[^\s@<>"]+@[^\s@<>"]+\.[A-Za-z]{2,}$/.test(value) ? value : null;
})();

/**
 * ---------------------------------------------------------------------------
 * Currency configuration — INITIAL VALUES
 * ---------------------------------------------------------------------------
 * USDT is the platform's primary/settlement currency; INR is shown alongside
 * as an approximate local equivalent.
 *
 * These are the values the platform starts with, and the fallback if the
 * stored settings are missing or unusable. The live values are set by an
 * administrator in Admin → Settings (`platform_settings.currency` and
 * `.withdrawals`) and resolved by `@/lib/platform-finance`; nothing
 * customer-facing reads these constants directly. The `MOCK_` names are kept
 * so existing seed data still imports them.
 */
/** Rate used for INR figures on deposits, balances and every display. */
export const MOCK_USDT_INR_RATE = 100.4;

/** Rate an INR withdrawal payout is priced at. */
export const MOCK_USDT_INR_PAYOUT_RATE = 100.4;

/** Label shown beside INR figures so they never read as a live market quote. */
export const MOCK_RATE_LABEL = "Platform rate set by Zomato Play";

export const CURRENCY = {
  primary: "USDT",
  secondary: "INR",
} as const;

/**
 * ---------------------------------------------------------------------------
 * Deposit / withdrawal configuration
 * ---------------------------------------------------------------------------
 */
export const MIN_DEPOSIT_USDT = 10;
export const MIN_WITHDRAWAL_USDT = 20;

/** Initial withdrawal fee, in USDT. Administrator-configurable. */
export const WITHDRAWAL_FEE_USDT = 1.55;

/** Initial percentage fee on top of the flat fee — none. Administrator-configurable. */
export const WITHDRAWAL_FEE_PERCENT = 0;

export const WITHDRAWAL_PROCESSING_WINDOW = "Usually within 2–4 hours";
