import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import {
  MIN_SECRET_LENGTH,
  signCustomerSession,
  verifyCustomerSession,
  type CustomerSessionClaims,
} from "@/server/auth/customer-session-token";

/**
 * The operator's session: an httpOnly cookie this server signs after a
 * verified SMS sign-in (`completeOperatorPhoneSignIn`).
 *
 * Same construction as the customer session (`customer-session-token.ts`) —
 * the Firebase uid, the operator's `session_epoch` at issue, an expiry — with
 * the audience `operator` inside the HMAC, so a customer's cookie cannot be
 * replayed here even by the same person. Shorter-lived than a customer's:
 * `OPERATOR_SESSION_HOURS`, 1–24, default 12.
 *
 * Revocation is the epoch, compared on the same read that loads the operator:
 * sign-out, a phone change and "end sessions" all increment it.
 *
 * Signed with `OPERATOR_SESSION_SECRET`, or `CUSTOMER_SESSION_SECRET` when that
 * is not set — safe because of the audience separation, and one fewer secret
 * to provision. Rotating either signs every operator out.
 */

export const OPERATOR_SESSION_COOKIE = "nanotron-operator-session";

export function readOperatorSessionSecret(): string | null {
  const own = process.env.OPERATOR_SESSION_SECRET?.trim() ?? "";
  if (own.length >= MIN_SECRET_LENGTH) return own;
  const shared = process.env.CUSTOMER_SESSION_SECRET?.trim() ?? "";
  return shared.length >= MIN_SECRET_LENGTH ? shared : null;
}

export function isOperatorSessionConfigured(): boolean {
  return readOperatorSessionSecret() !== null;
}

function maxAgeSeconds(): number {
  const hours = Number(process.env.OPERATOR_SESSION_HOURS ?? "12");
  const clamped = Number.isFinite(hours) ? Math.min(Math.max(hours, 1), 24) : 12;
  return Math.floor(clamped * 3600);
}

/** The verified claims on this request's operator cookie, or null. */
export const readOperatorSessionClaims = cache(
  async function readOperatorSessionClaims(): Promise<CustomerSessionClaims | null> {
    let value: string | undefined;
    try {
      value = (await cookies()).get(OPERATOR_SESSION_COOKIE)?.value;
    } catch {
      return null; // no request scope
    }
    const secret = readOperatorSessionSecret();
    if (!value || !secret) return null;
    return verifyCustomerSession(value, secret, Math.floor(Date.now() / 1000), "operator");
  },
);

export async function issueOperatorSession(operator: {
  firebaseUid: string;
  sessionEpoch: number;
}): Promise<void> {
  const secret = readOperatorSessionSecret();
  if (!secret) throw new Error("No operator session secret is configured.");
  const maxAge = maxAgeSeconds();
  const iat = Math.floor(Date.now() / 1000);
  const value = signCustomerSession(
    { fid: operator.firebaseUid, ep: operator.sessionEpoch, iat, exp: iat + maxAge },
    secret,
    "operator",
  );
  (await cookies()).set(OPERATOR_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Strict: an operator session has no reason to ride along on a link from
    // another site, and the console holds other people's identity documents.
    sameSite: "strict",
    path: "/",
    maxAge,
  });
}

export async function clearOperatorSessionCookie(): Promise<void> {
  try {
    (await cookies()).delete(OPERATOR_SESSION_COOKIE);
  } catch {
    // Read-only cookie store (a server component); sign-out is an action.
  }
}
