import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The customer session cookie's contents, signed by this application.
 *
 * WHY NOT FIREBASE SESSION COOKIES
 * --------------------------------
 * Firebase's `createSessionCookie` needs a service-account private key — a
 * credential that can mint a session for any user in the project. Verifying
 * the ID token Firebase hands the browser after an OTP needs only the public
 * project id. So the server verifies that token once, at sign-in, and then
 * issues its own session: an HMAC-SHA256-signed payload under a server-only
 * secret (`CUSTOMER_SESSION_SECRET`). No Firebase private key exists anywhere
 * in this deployment.
 *
 * WHAT IS IN IT
 * -------------
 *   fid  the Firebase uid — how the account is found (`users.firebase_uid`)
 *   ep   the account's `session_epoch` when it was issued — sign-out bumps
 *        the column, which invalidates every session issued before it, on
 *        the same read that loads the account (no extra round trip)
 *   iat / exp  seconds
 *
 * Nothing in it is secret (it is signed, not encrypted) and the cookie is
 * httpOnly regardless. Pure and dependency-free so it is tested directly.
 */

export interface CustomerSessionClaims {
  /** Firebase uid. */
  fid: string;
  /** `users.session_epoch` at issue. */
  ep: number;
  /** Issued at, seconds. */
  iat: number;
  /** Expires at, seconds. */
  exp: number;
}

const VERSION = "v1";
/** A secret shorter than this is refused, not used. */
export const MIN_SECRET_LENGTH = 32;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${VERSION}.${body}`).digest("base64url");
}

export function signCustomerSession(claims: CustomerSessionClaims, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error("CUSTOMER_SESSION_SECRET is too short.");
  }
  const body = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${VERSION}.${body}.${sign(body, secret)}`;
}

/**
 * The claims, or null for anything that is not a valid, unexpired session
 * signed with `secret`. Never throws on attacker-controlled input.
 */
export function verifyCustomerSession(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): CustomerSessionClaims | null {
  if (secret.length < MIN_SECRET_LENGTH || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, signature] = parts;

  const expected = Buffer.from(sign(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isClaims(claims)) return null;
  if (claims.exp <= nowSeconds || claims.iat > nowSeconds + 60) return null;
  return claims;
}

function isClaims(value: unknown): value is CustomerSessionClaims {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.fid === "string" &&
    v.fid.length > 0 &&
    v.fid.length <= 128 &&
    Number.isInteger(v.ep) &&
    Number.isInteger(v.iat) &&
    Number.isInteger(v.exp)
  );
}
