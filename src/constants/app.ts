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
export const APP_NAME = "Nanotron";
export const APP_TAGLINE = "Crypto investment platform";
export const APP_DESCRIPTION = `${APP_NAME} is a mobile-first crypto investment platform: fund your account in USDT, invest in managed plans, track rewards and refer friends.`;

/**
 * Where a referral link points.
 *
 * `/login?ref=CODE`: customers register by mobile number on `/login`, so the
 * link lands on the form that creates the account. The middleware captures
 * `?ref=` on any route into the cookie that decides attribution at account
 * creation (`resolveReferrer`); the query is only the carrier.
 *
 * INTEGRATION POINT: set `NEXT_PUBLIC_SITE_URL` to the public origin in every
 * deployment. Without it a link copied out of the app falls back to the
 * hosting provider's hostname.
 */
export const REFERRAL_BASE_URL = `${(
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://nanotron.vercel.app"
).replace(/\/+$/, "")}/login`;

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
 * Currency configuration
 * ---------------------------------------------------------------------------
 * USDT is the platform's primary/settlement currency. INR is displayed
 * alongside it as an approximate local equivalent.
 *
 * `MOCK_USDT_INR_RATE` is a static prototype value — NOT a live market rate.
 * At integration time replace `getUsdtInrRate()` in `@/lib/currency` with a
 * call to a real rates service; no component reads this constant directly.
 */
export const MOCK_USDT_INR_RATE = 83.2;

/**
 * Rate applied to INR withdrawal payouts. Deliberately different from the
 * display rate so the UI can show an explicit, quoted "payout rate".
 * Prototype value only.
 */
export const MOCK_USDT_INR_PAYOUT_RATE = 82.9;

/** Timestamp shown next to the rate so it never reads as a live quote. */
export const MOCK_RATE_LABEL = "Indicative rate · updated daily";

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

/** Flat network/processing fee applied to withdrawals in the prototype. */
export const WITHDRAWAL_FEE_USDT = 1.5;

/** Percentage fee applied on top of the flat fee. */
export const WITHDRAWAL_FEE_PERCENT = 0.5;

export const WITHDRAWAL_PROCESSING_WINDOW = "Usually within 2–4 hours";
