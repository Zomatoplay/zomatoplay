import "server-only";

import { normalizeIndianMobile } from "@/lib/phone";
import type { PhoneProof, PhoneProofPurpose } from "@/types";

import { readCustomerSessionSecret } from "./customer-session";
import { DEV_TEST_UID_PREFIX, sameSecret, verifyDevChallenge } from "./dev-test-auth";
import { localTestCustomer, localTestOperator } from "./dev-test-gate";
import { FirebaseCredentialError, verifyPhoneIdToken } from "./firebase-admin";

/**
 * "This person controls this mobile number, as of the last five minutes" —
 * the one question operator sign-in and withdrawal-password setup both ask.
 *
 * A proof is either:
 *   firebase    the ID token Firebase issued after the person typed the SMS
 *               code — verified by signature and project, `sign_in_provider`
 *               phone, `auth_time` under five minutes (`verifyPhoneIdToken`);
 *   local-test  on `next dev` + localhost + `DEV_TEST_AUTH=true` only, the
 *               configured test code against a signed, expiring challenge
 *               (`dev-test-auth.ts`). Dead code in a production build.
 *
 * What a proof grants is decided by the caller, against its own records: the
 * uid and number returned here are facts about the phone, never an identity
 * on their own. The challenge is bound to its purpose, so a code started for a
 * customer step-up cannot be spent on an operator sign-in.
 */

export type { PhoneProof, PhoneProofPurpose };

export interface VerifiedPhone {
  uid: string;
  phoneE164: string;
}

const INVALID = "Invalid or expired OTP.";

/** The challenge subject: the purpose and the number, so neither can be swapped. */
export function localProofSubject(purpose: PhoneProofPurpose, phoneE164: string): string {
  return `${purpose}:${phoneE164}`;
}

export async function verifyPhoneProof(
  proof: unknown,
  purpose: PhoneProofPurpose,
): Promise<VerifiedPhone> {
  if (typeof proof !== "object" || proof === null) throw new FirebaseCredentialError(INVALID);
  const candidate = proof as Record<string, unknown>;

  if (candidate.kind === "firebase") {
    const idToken = typeof candidate.idToken === "string" ? candidate.idToken : "";
    if (idToken.length < 20 || idToken.length > 8192) throw new FirebaseCredentialError(INVALID);
    const decoded = await verifyPhoneIdToken(idToken);
    const phoneE164 = normalizeIndianMobile(decoded.phone_number ?? "");
    if (!phoneE164) {
      throw new FirebaseCredentialError("Only Indian mobile numbers (+91) are supported.");
    }
    return { uid: decoded.uid, phoneE164 };
  }

  if (candidate.kind === "local-test") {
    // Both gates re-checked here, per request; a production build returns null.
    const config = purpose === "operator" ? await localTestOperator() : await localTestCustomer();
    const secret = readCustomerSessionSecret();
    if (!config || !secret) throw new FirebaseCredentialError(INVALID);
    const phoneE164 = normalizeIndianMobile(String(candidate.phone ?? ""));
    if (
      phoneE164 !== config.phoneE164 ||
      !verifyDevChallenge(String(candidate.challenge ?? ""), localProofSubject(purpose, phoneE164), secret) ||
      !sameSecret(String(candidate.code ?? ""), config.code)
    ) {
      throw new FirebaseCredentialError(INVALID);
    }
    return { uid: `${DEV_TEST_UID_PREFIX}${phoneE164}`, phoneE164 };
  }

  throw new FirebaseCredentialError(INVALID);
}
