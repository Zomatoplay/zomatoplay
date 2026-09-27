/**
 * Indian mobile numbers: one normal form, used everywhere.
 *
 * Phone sign-in makes the number an identity, and an identity with two
 * spellings is two identities. `+91 98765 43210`, `09876543210` and
 * `919876543210` are one person, so every path — the form before the OTP is
 * sent, the server reading a verified token, the uniqueness constraint on
 * `users.phone_e164` — goes through `normalizeIndianMobile` and compares E.164.
 *
 * Shared by browser and server on purpose, so the number the form sends to
 * Firebase and the number the server stores cannot disagree. It decides
 * nothing about identity on its own: the server stores only the number a
 * *verified* Firebase token carries, normalised through here.
 *
 * Indian mobile numbers are ten digits beginning 6–9 (the TRAI mobile series).
 * Landlines and other countries are refused rather than guessed at — the
 * product pays out to Indian bank accounts, and the Firebase project should
 * restrict SMS to +91 anyway (see CLAUDE.md §19).
 */

const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** `+91XXXXXXXXXX`, or null when the input is not an Indian mobile number. */
export function normalizeIndianMobile(input: string): string | null {
  if (typeof input !== "string") return null;
  // Separators people type or paste: spaces, dashes, dots, brackets.
  let digits = input.trim().replace(/[\s\-().]/g, "");

  if (digits.startsWith("+")) {
    // An explicit country code must be India's; "+1 98…" is not a typo to fix.
    if (!digits.startsWith("+91")) return null;
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    // The domestic trunk prefix.
    digits = digits.slice(1);
  }

  return INDIAN_MOBILE.test(digits) ? `+91${digits}` : null;
}

/** True only for the exact normal form — for values that should already be normalised. */
export function isNormalizedIndianMobile(value: string | null | undefined): value is string {
  return typeof value === "string" && /^\+91[6-9]\d{9}$/.test(value);
}

/**
 * `+91 98XXX XX210` — enough for the owner to recognise, not enough to use.
 * Used on the OTP screen and anywhere a verified number is shown back.
 */
export function maskIndianMobile(e164: string): string {
  if (!isNormalizedIndianMobile(e164)) return "+91 XXXXX XXXXX";
  const national = e164.slice(3);
  return `+91 ${national.slice(0, 2)}XXX XX${national.slice(7)}`;
}

/** `+91 98765 43210`, for a number the account holder already owns. */
export function formatIndianMobile(e164: string): string {
  if (!isNormalizedIndianMobile(e164)) return e164;
  const national = e164.slice(3);
  return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
}
