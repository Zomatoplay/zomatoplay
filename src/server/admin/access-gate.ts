import "server-only";

import { createHmac } from "node:crypto";

import { cookies } from "next/headers";

import { normalizeIndianMobile } from "@/lib/phone";
import { sameSecret } from "@/server/auth/dev-test-auth";

import { readOperatorSessionSecret } from "./operator-session";

/**
 * The administrator access gate — a second factor asked BEFORE any SMS is sent.
 *
 *   ADMIN_LOGIN_MOBILE        the number(s) allowed to start operator sign-in
 *                              (comma-separated when there is more than one)
 *   ADMIN_LOGIN_ACCESS_CODE   exactly 10 letters/digits, compared here
 *
 * Both are server-only environment values: never `NEXT_PUBLIC_`, never stored,
 * never logged, never returned. It does not replace the SMS code — Firebase
 * still proves control of the number — and it fails CLOSED: with either value
 * missing or malformed, operator sign-in is refused rather than left open.
 *
 * WHY A PASS COOKIE AS WELL
 * -------------------------
 * Firebase sends the SMS from the browser, so the server cannot physically stop
 * a script calling Firebase directly. What it can do is refuse to turn the
 * resulting proof into a session: a correct access code mints a short-lived,
 * signed, httpOnly pass bound to that number, and
 * `completeOperatorPhoneSignIn` requires it. Knowing a number is not enough.
 */

const CODE_SHAPE = /^[A-Za-z0-9]{10}$/;
export const ACCESS_PASS_COOKIE = "nanotron-operator-gate";
const PASS_SECONDS = 15 * 60;

function configuredNumbers(): string[] {
  return (process.env.ADMIN_LOGIN_MOBILE ?? "")
    .split(",")
    .map((value) => normalizeIndianMobile(value))
    .filter((value): value is string => value !== null);
}

function configuredCode(): string | null {
  const code = (process.env.ADMIN_LOGIN_ACCESS_CODE ?? "").trim();
  return CODE_SHAPE.test(code) ? code : null;
}

export function isAccessGateConfigured(): boolean {
  return configuredNumbers().length > 0 && configuredCode() !== null;
}

/** Is this (already normalised) number one the deployment authorised? */
export function isAuthorizedAdminMobile(phoneE164: string | null): boolean {
  return phoneE164 !== null && configuredNumbers().includes(phoneE164);
}

/** Constant-time check of the typed code. False when the gate is not configured. */
export function accessCodeMatches(given: string): boolean {
  const expected = configuredCode();
  if (!expected || typeof given !== "string" || !CODE_SHAPE.test(given.trim())) return false;
  return sameSecret(given.trim(), expected);
}

function passSignature(phoneE164: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`gate.${phoneE164}.${exp}`).digest("base64url");
}

export async function issueAccessPass(phoneE164: string): Promise<void> {
  const secret = readOperatorSessionSecret();
  if (!secret) throw new Error("No operator session secret is configured.");
  const exp = Math.floor(Date.now() / 1000) + PASS_SECONDS;
  (await cookies()).set(
    ACCESS_PASS_COOKIE,
    `${exp}.${passSignature(phoneE164, exp, secret)}`,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: PASS_SECONDS,
    },
  );
}

/** True only when this request carries an unexpired pass issued for this number. */
export async function hasAccessPass(phoneE164: string): Promise<boolean> {
  const secret = readOperatorSessionSecret();
  if (!secret || !isAuthorizedAdminMobile(phoneE164)) return false;
  let value: string | undefined;
  try {
    value = (await cookies()).get(ACCESS_PASS_COOKIE)?.value;
  } catch {
    return false;
  }
  const [expText, signature] = (value ?? "").split(".");
  const exp = Number(expText);
  if (!signature || !Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  return sameSecret(signature, passSignature(phoneE164, exp, secret));
}

export async function clearAccessPass(): Promise<void> {
  try {
    (await cookies()).delete(ACCESS_PASS_COOKIE);
  } catch {
    // Read-only cookie store; the pass expires on its own in 15 minutes.
  }
}
