/**
 * Application-wide constants.
 *
 * Everything here is prototype configuration. Values that will later come from
 * a backend, a rates provider or a CMS are marked so they are easy to find.
 */

export const APP_NAME = "Nanotron";
export const APP_TAGLINE = "Crypto investment platform";
export const APP_DESCRIPTION =
  "Nanotron is a mobile-first crypto investment platform: fund your account in USDT, invest in managed plans, track rewards and refer friends.";

/** Mock referral base URL. Replace with the real origin at integration time. */
/**
 * Where a referral link points.
 *
 * `/signup?ref=CODE` rather than a prettier `/join/CODE`: the query form is
 * what the middleware captures, on any route, into the cookie that survives the
 * signup and the email confirmation that follows it. A path form would need its
 * own route whose only job is to set the same cookie and redirect here.
 *
 * INTEGRATION POINT: set `NEXT_PUBLIC_SITE_URL` in a real deployment. The
 * fallback is the production hostname, which is right for a link somebody
 * copies out of the app and wrong for one they follow on localhost.
 */
export const REFERRAL_BASE_URL = `${
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://nanotron.vercel.app"
}/signup`;

/** Support contact shown in Settings → Support. Placeholder values. */
export const SUPPORT_EMAIL = "support@nanotron.app";

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
