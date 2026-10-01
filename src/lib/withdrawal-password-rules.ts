/**
 * The rules for a new withdrawal password — shared by the form, which checks
 * them as the person types, and the server, which enforces them
 * (`withdrawal-password.service.ts`). Pure, no server imports, tested in
 * `withdrawal-password-rules.test.ts`.
 */

export const WITHDRAWAL_PASSWORD_MIN_LENGTH = 8;
export const WITHDRAWAL_PASSWORD_MAX_LENGTH = 64;
/** Wrong passwords allowed before withdrawals lock. */
export const WITHDRAWAL_PASSWORD_MAX_ATTEMPTS = 5;
export const WITHDRAWAL_PASSWORD_LOCK_MINUTES = 30;

/**
 * Why a new withdrawal password is not acceptable, or null. Pure.
 *
 * At least 8 characters with a letter and a digit, and not the account's own
 * phone number — guessable things refused, nothing exotic required.
 */
export function withdrawalPasswordRefusal(
  password: unknown,
  confirm: unknown,
  phoneE164?: string | null,
): string | null {
  if (typeof password !== "string" || typeof confirm !== "string") {
    return "Enter your new withdrawal password twice.";
  }
  if (password.length < WITHDRAWAL_PASSWORD_MIN_LENGTH) {
    return `Use at least ${WITHDRAWAL_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > WITHDRAWAL_PASSWORD_MAX_LENGTH) {
    return `Use at most ${WITHDRAWAL_PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password !== password.trim()) {
    return "The password cannot start or end with a space.";
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Use both letters and numbers.";
  }
  if (/^(.)\1+$/.test(password)) return "Choose a less predictable password.";
  const digits = password.replace(/\D/g, "");
  if (phoneE164 && digits.length >= 10 && phoneE164.endsWith(digits.slice(-10))) {
    return "Do not use your mobile number.";
  }
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}

