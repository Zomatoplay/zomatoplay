import { BUSINESS_UTC_OFFSET_MINUTES } from "@/lib/business-time";

/**
 * The identity details a KYC submission declares — date of birth and the
 * document's type and number — and the rules for them.
 *
 * Pure and shared: the form uses it for immediate feedback and
 * `submitKycAction` runs the same functions again, so a request that skips
 * the browser is refused by identical rules (`kyc-identity.test.ts`).
 *
 * THE FULL NUMBER IS VALIDATED, NEVER STORED
 * ------------------------------------------
 * The server receives the whole number so it can check its format (the old
 * flow sent only four characters, which no server can validate), then keeps
 * only the masked form. Aadhaar in particular may not be stored in full by a
 * business that is not a UIDAI-authorised entity with an Aadhaar Data Vault,
 * so this masks every type the same way rather than special-casing one.
 */

export const KYC_DOCUMENT_TYPES = [
  {
    id: "aadhaar",
    label: "Aadhaar",
    placeholder: "1234 5678 9012",
    inputMode: "numeric",
    maxLength: 14,
  },
  {
    id: "pan",
    label: "PAN",
    placeholder: "ABCDE1234F",
    inputMode: "text",
    maxLength: 10,
  },
  {
    id: "passport",
    label: "Passport",
    placeholder: "A1234567",
    inputMode: "text",
    maxLength: 8,
  },
  {
    id: "driving_licence",
    label: "Driving licence",
    placeholder: "MH12 20110012345",
    inputMode: "text",
    maxLength: 20,
  },
  {
    id: "national_id",
    label: "Other national ID",
    placeholder: "As printed on the document",
    inputMode: "text",
    maxLength: 24,
  },
] as const;

export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number]["id"];

export function isKycDocumentType(value: unknown): value is KycDocumentType {
  return KYC_DOCUMENT_TYPES.some((type) => type.id === value);
}

export function kycDocumentLabel(type: KycDocumentType): string {
  return KYC_DOCUMENT_TYPES.find((entry) => entry.id === type)?.label ?? "Document";
}

/** Uppercase, with the spaces, hyphens, dots and slashes people type removed. */
export function normalizeDocumentNumber(raw: string): string {
  return raw.replace(/[\s\-./]/g, "").toUpperCase();
}

/*
 * Verhoeff — the check digit every Aadhaar number carries. A single mistyped
 * or swapped digit fails it, which is the typo this exists to catch.
 */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

export function verhoeffValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let check = 0;
  const reversed = digits.split("").reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    check = VERHOEFF_D[check][VERHOEFF_P[i % 8][Number(reversed[i])]];
  }
  return check === 0;
}

/**
 * Why `raw` is not a valid number for `type`, or null when it is.
 *
 * - Aadhaar: 12 digits, not starting with 0 or 1, valid Verhoeff check digit.
 * - PAN: AAAAA9999A, the fourth letter a holder type the Income Tax
 *   Department issues.
 * - Passport: an Indian passport — one letter and seven digits.
 * - Driving licence: Indian licences have several historical layouts
 *   (`MH12 20110012345`, `DL-0420110149646`, `KA01 19960012345`), so the rule
 *   is the part they share: a two-letter state code, then 8–14 letters or
 *   digits, at least six of them digits. Strict enough to stop arbitrary
 *   text, loose enough not to refuse a real licence.
 * - Other national ID: 4–20 letters and digits.
 */
export function documentNumberRefusal(type: KycDocumentType, raw: string): string | null {
  const value = normalizeDocumentNumber(raw);
  if (value.length === 0) return "Enter your document number.";
  if (!/^[A-Z0-9]+$/.test(value)) return "Use only letters and numbers.";

  switch (type) {
    case "aadhaar":
      if (!/^\d{12}$/.test(value)) return "An Aadhaar number has 12 digits.";
      if (!/^[2-9]/.test(value) || !verhoeffValid(value)) {
        return "That Aadhaar number isn't valid. Check the digits.";
      }
      return null;
    case "pan":
      if (!/^[A-Z]{3}[ABCFGHJLPT][A-Z]\d{4}[A-Z]$/.test(value)) {
        return "A PAN looks like ABCDE1234F — 5 letters, 4 digits, 1 letter.";
      }
      return null;
    case "passport":
      if (!/^[A-Z][1-9]\d{6}$/.test(value)) {
        return "A passport number is 1 letter followed by 7 digits.";
      }
      return null;
    case "driving_licence":
      if (
        !/^[A-Z]{2}[A-Z0-9]{8,14}$/.test(value) ||
        (value.match(/\d/g)?.length ?? 0) < 6
      ) {
        return "Enter the licence number as printed, starting with the state code (e.g. MH12 20110012345).";
      }
      return null;
    case "national_id":
      if (value.length < 4 || value.length > 20) return "Enter 4–20 letters and numbers.";
      return null;
  }
}

/** What is stored: the last four characters only. */
export function maskDocumentNumber(raw: string): string {
  return `•••• •••• ${normalizeDocumentNumber(raw).slice(-4)}`;
}

export const MINIMUM_KYC_AGE = 18;

/** Today's date on the business calendar (IST), as `YYYY-MM-DD`. */
export function businessToday(now: Date = new Date()): string {
  return new Date(now.getTime() + BUSINESS_UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** The latest date of birth that is 18 today — the form's `max`. */
export function latestAdultBirthDate(now: Date = new Date()): string {
  const [y, m, d] = businessToday(now).split("-").map(Number);
  // Today is 29 February and the target year has none: Date.UTC rolls over
  // to 1 March, so step back to 28 February — someone born on the 28th
  // turned 18 today; someone born on 1 March has not.
  const target = new Date(Date.UTC(y - MINIMUM_KYC_AGE, m - 1, d));
  if (target.getUTCMonth() !== m - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}

/**
 * Why `dob` is not an acceptable date of birth, or null. A real calendar date,
 * not in the future, at least 18 years before today (IST), and not
 * implausibly old.
 */
export function dateOfBirthRefusal(dob: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return "Enter your date of birth.";
  const [y, m, d] = dob.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  if (
    parsed.getUTCFullYear() !== y ||
    parsed.getUTCMonth() !== m - 1 ||
    parsed.getUTCDate() !== d
  ) {
    return "That date doesn't exist.";
  }
  const today = businessToday(now);
  if (dob > today) return "Your date of birth can't be in the future.";
  if (dob > latestAdultBirthDate(now)) return "You must be at least 18 to verify your identity.";
  if (y < Number(today.slice(0, 4)) - 120) return "Check the year of your date of birth.";
  return null;
}
