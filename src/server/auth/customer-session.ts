import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";

import { trackPipeline } from "@/server/observability";

import {
  MIN_SECRET_LENGTH,
  signCustomerSession,
  verifyCustomerSession,
} from "./customer-session-token";
import { getAuthPrincipal } from "./session";

/**
 * Who the customer on this request is — the one question every gate asks.
 *
 * TWO CREDENTIALS, ONE ORDER
 * --------------------------
 *   1. The **customer session cookie** (`nanotron-session`) — issued by this
 *      server after it verified a Firebase phone-OTP ID token, signed with
 *      `CUSTOMER_SESSION_SECRET` (`customer-session-token.ts`). Verified
 *      locally on every request: no network call, no Firebase key.
 *   2. A Supabase session — the legacy email sign-in, kept so an existing
 *      customer can reach their account once more and link a verified phone
 *      number to it (CLAUDE.md §19.7). Operators keep Supabase permanently.
 *
 * Firebase is checked first and wins when valid. The two resolve through
 * different columns (`users.firebase_uid`, `users.auth_user_id`), and the only
 * path that ever puts both on one account is the link flow, which requires
 * the Supabase session to already own that account — so precedence cannot
 * move anybody into an account they did not already hold.
 *
 * The cookie is httpOnly, Secure in production and SameSite=Lax: JavaScript
 * cannot read it, which is also why a signed-in state survives an installed
 * PWA being closed and reopened without any token in browser storage.
 */

export const CUSTOMER_SESSION_COOKIE = "nanotron-session";

export type CustomerPrincipal =
  | {
      kind: "firebase";
      firebaseUid: string;
      /** Compared with `users.session_epoch` when the account is loaded. */
      sessionEpoch: number;
    }
  | {
      kind: "supabase";
      authUserId: string;
      email: string | null;
      fullName: string | null;
    };

export async function getCustomerPrincipal(): Promise<CustomerPrincipal | null> {
  return trackPipeline(
    {
      pipeline: "auth",
      layer: "external",
      operation: "auth.resolveCustomer",
      message: "Resolving the customer session",
    },
    () => loadCustomerPrincipal(),
  );
}

const loadCustomerPrincipal = cache(
  async function loadCustomerPrincipal(): Promise<CustomerPrincipal | null> {
    let sessionCookie: string | undefined;
    try {
      sessionCookie = (await cookies()).get(CUSTOMER_SESSION_COOKIE)?.value;
    } catch {
      // No request scope (a script, a test): nobody is signed in.
      return null;
    }

    if (sessionCookie) {
      const secret = readCustomerSessionSecret();
      const claims = secret ? verifyCustomerSession(sessionCookie, secret) : null;
      if (claims) {
        return { kind: "firebase", firebaseUid: claims.fid, sessionEpoch: claims.ep };
      }
      // An expired or invalid cookie falls through: it grants nothing, and a
      // legacy session in the same browser is still a real answer.
    }

    const legacy = await getAuthPrincipal();
    if (!legacy) return null;
    return {
      kind: "supabase",
      authUserId: legacy.authUserId,
      email: legacy.email,
      fullName: legacy.fullName,
    };
  },
);

/**
 * The signing secret, or null when it is missing or too short to be one.
 * Server-only; generate with `openssl rand -base64 48`. Rotating it signs
 * every customer out, which is also the emergency lever.
 */
export function readCustomerSessionSecret(): string | null {
  const secret = process.env.CUSTOMER_SESSION_SECRET?.trim() ?? "";
  return secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function isCustomerSessionConfigured(): boolean {
  return readCustomerSessionSecret() !== null;
}

/** How long a customer session lasts: `CUSTOMER_SESSION_DAYS`, 1–14, default 14. */
export function customerSessionMaxAgeMs(): number {
  const days = Number(process.env.CUSTOMER_SESSION_DAYS ?? "14");
  const clamped = Number.isFinite(days) ? Math.min(Math.max(days, 1), 14) : 14;
  return clamped * 24 * 60 * 60 * 1000;
}

/**
 * Issues the session for an account the server has just resolved from a
 * verified phone token. The inputs are the account's own columns, never
 * request data.
 */
export async function issueCustomerSession(account: {
  firebaseUid: string;
  sessionEpoch: number;
}): Promise<void> {
  const secret = readCustomerSessionSecret();
  if (!secret) throw new Error("CUSTOMER_SESSION_SECRET is not configured.");
  const maxAgeMs = customerSessionMaxAgeMs();
  const iat = Math.floor(Date.now() / 1000);
  const value = signCustomerSession(
    {
      fid: account.firebaseUid,
      ep: account.sessionEpoch,
      iat,
      exp: iat + Math.floor(maxAgeMs / 1000),
    },
    secret,
  );
  (await cookies()).set(CUSTOMER_SESSION_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export async function clearCustomerSessionCookie(): Promise<void> {
  try {
    (await cookies()).delete(CUSTOMER_SESSION_COOKIE);
  } catch {
    // Read-only cookie store (a server component). Sign-out is an action,
    // where this succeeds.
  }
}
