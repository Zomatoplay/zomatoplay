/**
 * The first-time profile a customer completes after their first OTP sign-in —
 * full name, gender and email are required; the photo is optional. Pure and
 * shared by the onboarding form (as an affordance) and the server (as the
 * rule), so the two can never disagree about what "complete" means.
 */

export const GENDERS = [
  { id: "male", label: "Male" },
  { id: "female", label: "Female" },
  { id: "not_sure", label: "Not sure" },
] as const;
export type Gender = (typeof GENDERS)[number]["id"];

export function isGender(value: unknown): value is Gender {
  return GENDERS.some((gender) => gender.id === value);
}

export function genderLabel(value: string | null | undefined): string | null {
  return GENDERS.find((gender) => gender.id === value)?.label ?? null;
}

/** A practical address check — the server lower-cases and length-bounds it. */
export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export type ProfileField = "fullName" | "gender" | "email";

/** Which required fields are still missing — empty means complete. */
export function missingProfileFields(profile: {
  fullName: string | null | undefined;
  gender: string | null | undefined;
  email: string | null | undefined;
}): ProfileField[] {
  const missing: ProfileField[] = [];
  if ((profile.fullName ?? "").trim().length < 2) missing.push("fullName");
  if (!isGender(profile.gender)) missing.push("gender");
  if (!isValidEmail(profile.email ?? "")) missing.push("email");
  return missing;
}
