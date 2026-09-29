"use server";

import { normalizeIndianMobile } from "@/lib/phone";
import { ensureAccountForFirebasePrincipal, isAccountLockedOut } from "@/server/auth/account";
import { issueCustomerSession, readCustomerSessionSecret } from "@/server/auth/customer-session";
import {
  DEV_TEST_UID_PREFIX,
  issueDevChallenge,
  sameSecret,
  verifyDevChallenge,
} from "@/server/auth/dev-test-auth";
import { localTestCustomer } from "@/server/auth/dev-test-gate";
import { recordSignIn } from "@/server/auth/sign-in-record";
import { toSafeFailure } from "@/server/errors";
import { recordPipelineEvent } from "@/server/observability";
import { clientAddress, takeToken } from "@/server/rate-limit";

import type { PhoneAuthResult } from "./phone-actions";

/**
 * LOCAL-ONLY customer test sign-in (`@/server/auth/dev-test-auth` explains the
 * gates). Replaces exactly one step of the real flow — Firebase sending and
 * checking an SMS code — with a comparison against `DEV_TEST_CUSTOMER_OTP`.
 * Everything after it is the production path: `ensureAccountForFirebasePrincipal`,
 * `issueCustomerSession`, the sign-in record.
 *
 * Every function re-checks the gate itself; a page that forgot to would still
 * not open it. Outside the gate the answer is the same sentence a real
 * misconfiguration gets, so this file advertises nothing on a public host.
 */

const UNAVAILABLE: PhoneAuthResult = { ok: false, message: "Phone sign-in is not available right now." };
const LIMIT = { attempts: 20, windowMs: 10 * 60 * 1000 };

export async function startLocalTestSignInAction(input: {
  phone: string;
}): Promise<PhoneAuthResult & { challenge?: string }> {
  const config = await localTestCustomer();
  const secret = readCustomerSessionSecret();
  if (!config || !secret) return UNAVAILABLE;
  if (!(await allowed())) return tooMany();

  const phoneE164 = normalizeIndianMobile(String(input?.phone ?? ""));
  if (phoneE164 !== config.phoneE164) {
    return { ok: false, message: "That is not the local test number." };
  }
  return {
    ok: true,
    message: "Local test code ready.",
    challenge: issueDevChallenge(phoneE164, secret, config.ttlSeconds),
  };
}

export async function completeLocalTestSignInAction(input: {
  phone: string;
  code: string;
  challenge: string;
  next?: string;
}): Promise<PhoneAuthResult> {
  const config = await localTestCustomer();
  const secret = readCustomerSessionSecret();
  if (!config || !secret) return UNAVAILABLE;
  if (!(await allowed())) return tooMany();

  const phoneE164 = normalizeIndianMobile(String(input?.phone ?? ""));
  if (
    phoneE164 !== config.phoneE164 ||
    !verifyDevChallenge(String(input?.challenge ?? ""), phoneE164, secret) ||
    !sameSecret(String(input?.code ?? ""), config.code)
  ) {
    // The same sentence the real flow uses for a wrong or expired code.
    return { ok: false, message: "Invalid or expired OTP." };
  }

  try {
    const firebaseUid = `${DEV_TEST_UID_PREFIX}${phoneE164}`;
    const account = await ensureAccountForFirebasePrincipal({ firebaseUid, phoneE164 });
    if (isAccountLockedOut(account.status)) {
      return { ok: false, message: `This account is ${account.status}. Contact support.` };
    }

    await issueCustomerSession({ firebaseUid, sessionEpoch: account.sessionEpoch });
    await recordSignIn(account.userId);
    recordPipelineEvent({
      pipeline: "auth",
      operation: "auth.local_test_sign_in",
      status: "ok",
      message: "Signed in through the LOCAL test path (development build, localhost)",
      userId: account.userId,
    });

    const next = input?.next ?? "/";
    return {
      ok: true,
      message: "Signed in.",
      redirectTo: account.profileComplete
        ? next.startsWith("/") && !next.startsWith("//") ? next : "/"
        : "/complete-profile",
    };
  } catch (error) {
    const safe = toSafeFailure(error, "Unable to sign in. Please try again.");
    return { ok: false, message: safe.message, retryable: safe.retryable };
  }
}

async function allowed(): Promise<boolean> {
  const address = await clientAddress();
  return takeToken(`local-test-sign-in:${address}`, LIMIT.attempts, LIMIT.windowMs).allowed;
}

function tooMany(): PhoneAuthResult {
  return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
}
