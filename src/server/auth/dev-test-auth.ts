import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeIndianMobile } from "@/lib/phone";

/**
 * LOCAL-ONLY test sign-in, for a customer and for an operator — the policy.
 *
 * WHY THIS EXISTS, AND WHY NOT FIREBASE TEST NUMBERS
 * --------------------------------------------------
 * Testing the customer flow on localhost otherwise needs a real phone and a
 * real SMS. Firebase's "phone numbers for testing" would avoid that, but they
 * are configured per *Firebase project* and this deployment uses one project
 * for every environment — a fictional number added for localhost would sign
 * in on the production domain too. So the test path lives here, where it can
 * be gated on the build and the request, instead.
 *
 * FOUR GATES, ALL REQUIRED (`devTestGateOpen`)
 * --------------------------------------------
 *  1. `NODE_ENV === "development"` — `next dev` only. Next inlines
 *     `process.env.NODE_ENV` into every bundle at build time, so in a
 *     production build (`next build`, which is what EC2 runs) the check is the
 *     constant `"production" === "development"` and the path is dead code.
 *  2. `DEV_TEST_AUTH=true` — an explicit opt-in on this machine.
 *  3. The request's `Host` (and `X-Forwarded-Host`, if any) is localhost,
 *     127.0.0.1 or ::1. A Host header can be forged, which is why it is the
 *     third gate and not the first.
 *  4. The test identity and code are configured in the environment (never in
 *     source): `DEV_TEST_CUSTOMER_PHONE` + `DEV_TEST_CUSTOMER_OTP`, or
 *     `DEV_ADMIN_EMAIL` + `DEV_ADMIN_PASSWORD` + `DEV_TEST_ADMIN_OTP`.
 *
 * WHAT IT DOES NOT BYPASS
 * -----------------------
 * Only the SMS / email delivery of a code. The customer path then runs the
 * same `ensureAccountForFirebasePrincipal` → `issueCustomerSession` as a real
 * sign-in, under a uid prefixed `dev-local:` so such accounts are
 * recognisable. The operator path signs in to Supabase as the *real*
 * development operator (`DEV_ADMIN_*`, linked by `npm run db:dev-accounts`)
 * and the browser then calls the ordinary `completeOperatorSignIn`, so the
 * `admin_agents` lookup and every permission check are unchanged.
 */

/** Firebase uid prefix for accounts created through the local test path. */
export const DEV_TEST_UID_PREFIX = "dev-local:";

const DEFAULT_CODE_TTL_SECONDS = 300;
const CHALLENGE_VERSION = "devchallenge.v1";

export interface DevTestGateInput {
  nodeEnv: string | undefined;
  flag: string | undefined;
  host: string | null;
  forwardedHost: string | null;
}

/** True for `localhost`, `*.localhost`, `127.0.0.1` and `::1`, with or without a port. */
export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const value = host.trim().toLowerCase();
  let hostname: string;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end < 0) return false;
    hostname = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest && !/^:\d{1,5}$/.test(rest)) return false;
  } else {
    const match = /^([a-z0-9.-]+)(?::\d{1,5})?$/.exec(value);
    if (!match) return false;
    hostname = match[1];
  }
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

export function devTestGateOpen(input: DevTestGateInput): boolean {
  if (input.nodeEnv !== "development") return false;
  if (input.flag !== "true") return false;
  if (!isLocalHost(input.host)) return false;
  // A proxy in front of the dev server must also be addressed locally.
  if (input.forwardedHost !== null && !isLocalHost(input.forwardedHost.split(",")[0])) {
    return false;
  }
  return true;
}

type Env = Record<string, string | undefined>;

const SIX_DIGITS = /^\d{6}$/;

function ttlFrom(env: Env): number {
  const parsed = Number(env.DEV_TEST_OTP_TTL_SECONDS);
  return Number.isInteger(parsed) && parsed >= 5 && parsed <= 3600
    ? parsed
    : DEFAULT_CODE_TTL_SECONDS;
}

export interface DevTestCustomer {
  phoneE164: string;
  code: string;
  ttlSeconds: number;
}

/** The configured test customer, or null when any part is missing or malformed. */
export function readDevTestCustomer(env: Env): DevTestCustomer | null {
  const phoneE164 = normalizeIndianMobile(env.DEV_TEST_CUSTOMER_PHONE ?? "");
  const code = (env.DEV_TEST_CUSTOMER_OTP ?? "").trim();
  if (!phoneE164 || !SIX_DIGITS.test(code)) return null;
  return { phoneE164, code, ttlSeconds: ttlFrom(env) };
}

export interface DevTestOperator {
  email: string;
  password: string;
  code: string;
  ttlSeconds: number;
}

/** The configured test operator, or null when any part is missing or malformed. */
export function readDevTestOperator(env: Env): DevTestOperator | null {
  const email = (env.DEV_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = env.DEV_ADMIN_PASSWORD ?? "";
  const code = (env.DEV_TEST_ADMIN_OTP ?? "").trim();
  if (!email.includes("@") || !password || !SIX_DIGITS.test(code)) return null;
  return { email, password, code, ttlSeconds: ttlFrom(env) };
}

/** Constant-time comparison of two short strings. */
export function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/*
 * THE CHALLENGE — so "expired OTP" exists locally too
 * ---------------------------------------------------
 * "Send OTP" returns a token binding the subject (the phone number or email)
 * to an expiry; "Verify" needs it back. It is HMAC-signed under a
 * domain-separated prefix, so it can never be mistaken for a customer session
 * cookie even though both are keyed by `CUSTOMER_SESSION_SECRET`.
 */

export function issueDevChallenge(
  subject: string,
  secret: string,
  ttlSeconds: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const body = Buffer.from(JSON.stringify({ s: subject, exp: nowSeconds + ttlSeconds }), "utf8")
    .toString("base64url");
  return `${body}.${challengeSignature(body, secret)}`;
}

export function verifyDevChallenge(
  token: string,
  subject: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof token !== "string" || token.length > 1024) return false;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return false;
  if (!sameSecret(signature, challengeSignature(body, secret))) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      s?: unknown;
      exp?: unknown;
    };
    return (
      claims.s === subject && typeof claims.exp === "number" && claims.exp > nowSeconds
    );
  } catch {
    return false;
  }
}

function challengeSignature(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${CHALLENGE_VERSION}.${body}`).digest("base64url");
}
