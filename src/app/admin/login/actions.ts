"use server";

import { redirect } from "next/navigation";

import {
  accessCodeAccepted,
  clearAccessPass,
  hasAccessPass,
  issueAccessPass,
} from "@/server/admin/access-gate";
import {
  clearOperatorSessionCookie,
  issueOperatorSession,
  isOperatorSessionConfigured,
} from "@/server/admin/operator-session";
import { endOperatorSessions, signInOperatorByPhone } from "@/server/admin/operator-sign-in";
import { getCurrentOperator } from "@/server/admin/session";
import { FirebaseNotConfiguredError } from "@/server/auth/firebase-admin";
import { normalizeIndianMobile } from "@/lib/phone";
import { verifyPhoneProof } from "@/server/auth/phone-proof";
import { isInfrastructureFailure, toSafeFailure } from "@/server/errors";
import { describeError, errorDiagnostics, recordPipelineEvent } from "@/server/observability";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { traceAction } from "@/server/trace-action";

/**
 * Operator sign-in: a verified mobile number becomes an operator session.
 *
 * The browser sends one thing — a proof that the person just typed the SMS
 * code for a number (`verifyPhoneProof`: a Firebase ID token, or the local
 * test code on a localhost dev build). The server decides everything else:
 * which operator that number was provisioned for (`signInOperatorByPhone`),
 * whether that operator is enabled, and then issues the httpOnly operator
 * cookie. There is no operator id, number or role parameter to tamper with.
 *
 * AN UNREACHABLE DATABASE IS NOT A REFUSED SIGN-IN
 * ------------------------------------------------
 * Three outcomes, kept distinct:
 *
 *   ok: true                        — signed in
 *   ok: false, retryable: false     — a verdict: not an operator, disabled,
 *                                     wrong or expired code
 *   ok: false, retryable: true      — no verdict was reached; try again
 *
 * `retryable` changes what the form says; it never lets anybody through. The
 * gate is `(console)/layout.tsx`, which resolves the operator again on every
 * request.
 */
export interface OperatorSignInResult {
  ok: boolean;
  message: string;
  /** True when the attempt failed for a reason that may clear on its own. */
  retryable?: boolean;
}

/** Per address: enough for a team on one office connection, tight for a script. */
const SIGN_IN_LIMIT = { attempts: 15, windowMs: 10 * 60 * 1000 };

/** Per address, counting every gate attempt — failed guesses are the point. */
const GATE_LIMIT = { attempts: 8, windowMs: 15 * 60 * 1000 };
/** Per number, so rotating addresses does not multiply the guesses. */
const GATE_NUMBER_LIMIT = { attempts: 20, windowMs: 60 * 60 * 1000 };

const GATE_REFUSED = "Administrator access could not be confirmed.";

/**
 * Step 1 of operator sign-in. With `code` absent it only checks the number is
 * a well-formed Indian mobile — deliberately NOT whether it belongs to an
 * operator, so this screen cannot be used to discover which numbers are
 * administrators. With a code it checks the code against that number (the
 * operator's own code from Admin → Agents, or the environment's bootstrap
 * code) and, when right, issues the short-lived pass the sign-in requires.
 * Every refusal says the same thing.
 */
export async function checkAdminAccess(input: {
  phone: string;
  code?: string;
}): Promise<{ ok: boolean; message: string }> {
  const address = await clientAddress();
  const phoneE164 = normalizeIndianMobile(String(input?.phone ?? ""));
  const withinLimit =
    takeToken(`operator-gate:${address}`, GATE_LIMIT.attempts, GATE_LIMIT.windowMs).allowed &&
    takeToken(`operator-gate-number:${phoneE164 ?? "?"}`, GATE_NUMBER_LIMIT.attempts, GATE_NUMBER_LIMIT.windowMs).allowed;
  if (!withinLimit) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }
  if (!isOperatorSessionConfigured()) {
    return { ok: false, message: "Operator sign-in is not configured on this server." };
  }
  if (!phoneE164) return { ok: false, message: "Enter a valid 10-digit Indian mobile number." };
  if (input.code === undefined) return { ok: true, message: "Enter your access code." };
  let accepted: boolean;
  try {
    accepted = await accessCodeAccepted(phoneE164, String(input.code));
  } catch (error) {
    recordPipelineEvent({
      pipeline: "admin",
      operation: "admin.access_gate.unavailable",
      status: "failed",
      message: "Operator access code could not be checked",
      errorMessage: describeError(error),
      metadata: errorDiagnostics(error),
    });
    return { ok: false, message: "Could not check your access code. Try again." };
  }
  if (!accepted) {
    recordPipelineEvent({
      pipeline: "admin",
      operation: "admin.access_gate.refused",
      status: "ok",
      message: "Operator access code was not accepted",
    });
    return { ok: false, message: GATE_REFUSED };
  }
  await issueAccessPass(phoneE164);
  return { ok: true, message: "Access code accepted." };
}

export async function completeOperatorPhoneSignIn(input: {
  proof: unknown;
}): Promise<OperatorSignInResult> {
  return traceAction(
    { name: "admin.sign_in", actorType: "admin", pipeline: "admin" },
    () => resolveOperatorSignIn(input?.proof),
  );
}

async function resolveOperatorSignIn(proof: unknown): Promise<OperatorSignInResult> {
  const address = await clientAddress();
  if (!takeToken(`operator-sign-in:${address}`, SIGN_IN_LIMIT.attempts, SIGN_IN_LIMIT.windowMs).allowed) {
    recordPipelineEvent({
      pipeline: "admin",
      operation: "admin.sign_in.rate_limited",
      status: "failed",
      message: "Refused: too many operator sign-in attempts from one address",
    });
    return {
      ok: false,
      retryable: false,
      message: "Too many attempts. Please wait a few minutes and try again.",
    };
  }
  if (!isOperatorSessionConfigured()) {
    return { ok: false, retryable: false, message: "Operator sign-in is not configured on this server." };
  }

  try {
    const verified = await verifyPhoneProof(proof, "operator");
    // The access code must have been accepted for THIS number first.
    if (!(await hasAccessPass(verified.phoneE164))) {
      return { ok: false, retryable: false, message: "Your access check expired. Start again." };
    }
    const operator = await signInOperatorByPhone(verified);
    await issueOperatorSession({
      firebaseUid: operator.firebaseUid,
      sessionEpoch: operator.sessionEpoch,
    });

    recordPipelineEvent({
      pipeline: "admin",
      operation: "admin.sign_in.granted",
      status: "ok",
      message: "Operator session established by SMS verification",
      actor: { id: operator.agentId, name: operator.name },
    });
    await clearAccessPass();
    return { ok: true, message: `Signed in as ${operator.name}.` };
  } catch (error) {
    if (error instanceof FirebaseNotConfiguredError) {
      return { ok: false, retryable: false, message: "Operator sign-in is not configured on this server." };
    }
    const failure = toSafeFailure(error, "Could not verify operator access. Try again.");

    recordPipelineEvent({
      pipeline: "admin",
      operation: "admin.sign_in.failed",
      // A refusal is the system working; an outage is not.
      status: isInfrastructureFailure(error) ? "failed" : "ok",
      message: isInfrastructureFailure(error)
        ? "Operator lookup could not complete — infrastructure, not a verdict"
        : "Operator sign-in was refused",
      errorMessage: describeError(error),
      metadata: {
        errorCategory: failure.category,
        retryable: failure.retryable,
        ...errorDiagnostics(error),
      },
    });

    return { ok: false, retryable: failure.retryable, message: failure.message };
  }
}

/**
 * Ends the operator session — on every device, not just this browser: the
 * operator's `session_epoch` moves, so every cookie issued before now stops
 * resolving on its next request. The redirect matters as much as the cookie:
 * every cached Server Component payload in the tab was rendered for the
 * operator who is leaving, and some of it is other people's identity documents.
 */
export async function signOutOperator(): Promise<never> {
  try {
    const operator = await getCurrentOperator();
    if (operator) await endOperatorSessions(operator.agentId);
  } catch {
    // The cookie is still cleared below; an unreachable database must not
    // keep somebody signed in on this device.
  }
  await clearOperatorSessionCookie();
  redirect("/admin/login");
}
