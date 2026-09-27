"use server";

import {
  ensureAccountForFirebasePrincipal,
  getAuthenticatedAccount,
  isAccountLockedOut,
  linkPhoneToAccount,
} from "@/server/auth/account";
import {
  isCustomerSessionConfigured,
  issueCustomerSession,
} from "@/server/auth/customer-session";
import {
  FirebaseCredentialError,
  FirebaseNotConfiguredError,
  verifyPhoneIdToken,
} from "@/server/auth/firebase-admin";
import { recordSignIn } from "@/server/auth/sign-in-record";
import { toSafeFailure } from "@/server/errors";
import {
  describeError,
  errorDiagnostics,
  recordPipelineEvent,
} from "@/server/observability";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { traceAction } from "@/server/trace-action";
import { normalizeIndianMobile } from "@/lib/phone";

/**
 * Finishing a phone OTP sign-in, server-side.
 *
 * The browser has sent an SMS code to Firebase and got back an ID token. That
 * token is the ONLY input: the server verifies it (signature, project, expiry,
 * `sign_in_provider = phone`, signed in within five minutes), reads the uid
 * and number from the verified claims, resolves the account from those, and
 * only then issues its own signed session cookie (`issueCustomerSession`). There is no user id,
 * phone number or account parameter to tamper with.
 *
 * WHAT A PERSON IS TOLD
 * ---------------------
 * "Invalid or expired OTP." for anything about the credential, and the same
 * success path whether the number already had an account or not — the only
 * visible difference is the profile step a new account sees next, which is
 * shown to somebody who has just proved they own the number.
 */
export interface PhoneAuthResult {
  ok: boolean;
  message: string;
  redirectTo?: string;
  retryable?: boolean;
}

/** Per address: generous for a household on one connection, tight for a script. */
const SIGN_IN_LIMIT = { attempts: 20, windowMs: 10 * 60 * 1000 };

export async function completePhoneSignInAction(input: {
  idToken: string;
  next?: string;
}): Promise<PhoneAuthResult> {
  return traceAction(
    { name: "auth.phone_sign_in", actorType: "user", pipeline: "auth" },
    async () => {
      const limited = await rateLimited("phone-sign-in");
      if (limited) return limited;
      if (!isCustomerSessionConfigured()) return notConfigured("auth.phone_sign_in");

      const idToken = typeof input.idToken === "string" ? input.idToken : "";
      if (idToken.length < 20 || idToken.length > 8192) {
        return { ok: false, message: "Invalid or expired OTP." };
      }

      try {
        const decoded = await verifyPhoneIdToken(idToken);
        const phoneE164 = normalizeIndianMobile(decoded.phone_number ?? "");
        if (!phoneE164) {
          return { ok: false, message: "Only Indian mobile numbers (+91) can sign in." };
        }

        const account = await ensureAccountForFirebasePrincipal({
          firebaseUid: decoded.uid,
          phoneE164,
        });

        // A blocked account holds a valid number and no access: no cookie.
        if (isAccountLockedOut(account.status)) {
          recordPipelineEvent({
            pipeline: "auth",
            operation: "auth.phone_sign_in",
            status: "failed",
            message: "Sign-in refused: the account is not active",
            userId: account.userId,
            errorMessage: `Account status is ${account.status}.`,
          });
          return { ok: false, message: `This account is ${account.status}. Contact support.` };
        }

        await issueCustomerSession({
          firebaseUid: decoded.uid,
          sessionEpoch: account.sessionEpoch,
        });
        await recordSignIn(account.userId);
        recordPipelineEvent({
          pipeline: "auth",
          operation: "auth.phone_sign_in",
          status: "ok",
          message: "Signed in with a verified phone number",
          userId: account.userId,
        });

        return {
          ok: true,
          message: "Signed in.",
          redirectTo: account.profileComplete ? safeNext(input.next) : "/complete-profile",
        };
      } catch (error) {
        return failure(error, "auth.phone_sign_in");
      }
    },
  );
}

/**
 * An existing customer, signed in by email, attaching a verified number.
 *
 * The account is the caller's own — resolved from their current session, not
 * sent — and must not already carry a Firebase uid. The number comes from the
 * verified token. Refusals (number already on another account, and so on) are
 * decided by `decidePhoneLink` and never merge accounts.
 */
export async function linkPhoneAction(input: { idToken: string }): Promise<PhoneAuthResult> {
  return traceAction(
    { name: "auth.phone_link", actorType: "user", pipeline: "auth" },
    async () => {
      const limited = await rateLimited("phone-link");
      if (limited) return limited;
      if (!isCustomerSessionConfigured()) return notConfigured("auth.phone_link");

      const account = await getAuthenticatedAccount();
      if (!account) return { ok: false, message: "Your session has expired. Sign in again." };
      if (account.signInMethod !== "email") {
        return { ok: true, message: "Already signed in with your mobile number.", redirectTo: "/" };
      }
      if (isAccountLockedOut(account.status)) {
        return { ok: false, message: `This account is ${account.status}. Contact support.` };
      }

      try {
        const decoded = await verifyPhoneIdToken(String(input.idToken ?? ""));
        const phoneE164 = normalizeIndianMobile(decoded.phone_number ?? "");
        if (!phoneE164) {
          return { ok: false, message: "Only Indian mobile numbers (+91) can be linked." };
        }

        const { account: linked } = await linkPhoneToAccount({
          userId: account.userId,
          firebaseUid: decoded.uid,
          phoneE164,
        });
        // From now on this account signs in by phone; the email session is
        // superseded by the phone session, which takes precedence.
        await issueCustomerSession({
          firebaseUid: decoded.uid,
          sessionEpoch: linked.sessionEpoch,
        });
        recordPipelineEvent({
          pipeline: "auth",
          operation: "auth.phone_link",
          status: "ok",
          message: "Linked a verified mobile number to an existing account",
          userId: account.userId,
        });
        return {
          ok: true,
          message: "Mobile number verified.",
          redirectTo: account.profileComplete ? "/" : "/complete-profile",
        };
      } catch (error) {
        return failure(error, "auth.phone_link");
      }
    },
  );
}

function notConfigured(operation: string): PhoneAuthResult {
  recordPipelineEvent({
    pipeline: "auth",
    operation,
    status: "failed",
    message:
      "Phone sign-in attempted but the server is not configured " +
      "(Firebase project id or CUSTOMER_SESSION_SECRET missing)",
  });
  return { ok: false, message: "Phone sign-in is not available right now." };
}

async function rateLimited(bucket: string): Promise<PhoneAuthResult | null> {
  const address = await clientAddress();
  const { allowed } = takeToken(
    `${bucket}:${address}`,
    SIGN_IN_LIMIT.attempts,
    SIGN_IN_LIMIT.windowMs,
  );
  if (allowed) return null;
  recordPipelineEvent({
    pipeline: "auth",
    operation: `auth.${bucket}.rate_limited`,
    status: "failed",
    message: "Refused: too many sign-in attempts from one address",
  });
  return {
    ok: false,
    message: "Too many attempts. Please wait a few minutes and try again.",
  };
}

function failure(error: unknown, operation: string): PhoneAuthResult {
  if (error instanceof FirebaseCredentialError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof FirebaseNotConfiguredError) return notConfigured(operation);

  const safe = toSafeFailure(error, "Unable to sign in. Please try again.");
  recordPipelineEvent({
    pipeline: "auth",
    operation,
    status: "failed",
    message: "Phone sign-in could not complete",
    errorMessage: describeError(error),
    metadata: { errorCategory: safe.category, ...errorDiagnostics(error) },
  });
  return { ok: false, message: safe.message, retryable: safe.retryable };
}

/** Only same-origin paths: an open redirect on sign-in lends a phishing page our domain. */
function safeNext(requested: string | undefined): string {
  const value = requested ?? "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
