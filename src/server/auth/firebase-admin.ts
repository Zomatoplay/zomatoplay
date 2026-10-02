import "server-only";

import { getApp, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

/**
 * The server half of phone sign-in: verifying the ID token Firebase issued
 * after an OTP. Nothing else.
 *
 * NO SERVICE-ACCOUNT KEY
 * ----------------------
 * Verifying an ID token needs only the project id: the SDK checks its
 * signature against Google's published certificates (fetched, then cached),
 * and its issuer, audience and expiry. A service-account private key would
 * only be needed to *mint* Firebase credentials — session cookies, custom
 * tokens, revocation — and this application mints none. After verification
 * the server issues its own session (`customer-session.ts`), so no Firebase
 * private key exists in this deployment at all.
 *
 * The project id is public (`NEXT_PUBLIC_FIREBASE_PROJECT_ID`, or
 * `FIREBASE_PROJECT_ID` to pin the server to it explicitly).
 */

export class FirebaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Phone sign-in is not configured on the server: no Firebase project id " +
        "(NEXT_PUBLIC_FIREBASE_PROJECT_ID) — see .env.example.",
    );
    this.name = "FirebaseNotConfiguredError";
  }
}

/** Could not reach a verdict — distinct from a rejected credential. */
export class FirebaseUnavailableError extends Error {
  constructor(message: string) {
    super(`The phone sign-in service is temporarily unreachable. ${message}`.trim());
    this.name = "FirebaseUnavailableError";
  }
}

/** A credential the server looked at and refused. Safe to show. */
export class FirebaseCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseCredentialError";
  }
}

const APP_NAME = "nanotron-verifier";

function readServerProjectId(): string | undefined {
  return (
    process.env.FIREBASE_PROJECT_ID?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() ||
    undefined
  );
}

/** Whether the server can verify a phone sign-in. */
export function isFirebaseVerifierConfigured(): boolean {
  return Boolean(readServerProjectId());
}

function getVerifierApp(): App {
  const existing = getApps().find((app) => app.name === APP_NAME);
  if (existing) return getApp(APP_NAME);
  const projectId = readServerProjectId();
  if (!projectId) throw new FirebaseNotConfiguredError();
  // No credential, deliberately: token verification does not use one.
  return initializeApp({ projectId }, APP_NAME);
}

/**
 * A verified ID token, refused unless it came from phone sign-in just now.
 *
 * `auth_time` within five minutes: an ID token stolen from somewhere else and
 * replayed later cannot be turned into a session. `sign_in_provider ===
 * "phone"` because this endpoint exists to accept an OTP-verified number and
 * nothing else — a token from another provider enabled on the same project by
 * mistake is refused rather than trusted.
 *
 * Revocation is not checked here (that call needs a service-account key). The
 * token is at most five minutes old by the check below, and Zomato Play's own
 * sessions are revocable (`users.session_epoch`).
 */
export async function verifyPhoneIdToken(idToken: string): Promise<DecodedIdToken> {
  let decoded: DecodedIdToken;
  try {
    decoded = await getAuth(getVerifierApp()).verifyIdToken(idToken);
  } catch (error) {
    throw classify(error);
  }

  if (decoded.firebase?.sign_in_provider !== "phone" || !decoded.phone_number) {
    throw new FirebaseCredentialError("That sign-in is not a verified phone number.");
  }
  const ageSeconds = Date.now() / 1000 - decoded.auth_time;
  if (!(ageSeconds >= -60 && ageSeconds < 5 * 60)) {
    throw new FirebaseCredentialError("That verification is too old. Request a new OTP.");
  }
  return decoded;
}

const OUTAGE_CODES = new Set([
  "app/network-error",
  "app/network-timeout",
  "auth/internal-error",
  "app/internal-error",
]);

function classify(error: unknown): Error {
  if (error instanceof FirebaseNotConfiguredError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : String(error);

  if (OUTAGE_CODES.has(code) || /ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(message)) {
    return new FirebaseUnavailableError(code);
  }
  // Expired, malformed, wrong project: all verdicts.
  return new FirebaseCredentialError("Invalid or expired OTP.");
}
