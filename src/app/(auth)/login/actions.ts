"use server";

import { ensureAccountForCurrentPrincipal, isAccountLockedOut } from "@/server/auth/account";
import { signOut } from "@/server/auth/session";
import { clearCustomerSessionCookie } from "@/server/auth/customer-session";
import { recordSignIn } from "@/server/auth/sign-in-record";
import { isInfrastructureFailure, toSafeFailure } from "@/server/errors";
import {
  describeError,
  errorDiagnostics,
  recordPipelineEvent,
} from "@/server/observability";
import { traceAction } from "@/server/trace-action";

/**
 * Finishes a sign-in, server-side.
 *
 * The browser has just authenticated with Supabase — by password, or by a
 * one-time code — and holds a session cookie. This runs on the server, reads
 * that session, and resolves or creates the matching `public.users` row.
 *
 * Deliberately takes no identity from the caller. `next` is a destination, and
 * it is checked below; the *account* comes from the verified session alone.
 */
export interface SignInResult {
  ok: boolean;
  message: string;
  redirectTo: string;
  /**
   * True when the sign-in did not fail — it failed to *complete*.
   *
   * Supabase has already verified the credential by the time this runs, so a
   * failure here is almost always the application's own database being
   * momentarily unreachable. Reported as a refusal it reads as "your password
   * is wrong", which is both false and the exact complaint that produced this
   * flag: correct credentials that sometimes would not sign in.
   */
  retryable?: boolean;
}

export async function completeSignIn(input: {
  next?: string;
}): Promise<SignInResult> {
  return traceAction(
    { name: "auth.sign_in", actorType: "user", pipeline: "auth" },
    () => resolveSignIn(input),
  );
}

async function resolveSignIn(input: { next?: string }): Promise<SignInResult> {
  try {
    // A phone session outranks an email one (`getCustomerPrincipal`). Signing in
    // by email is an explicit choice of account, so any phone session left in
    // this browser — possibly somebody else's — is ended first.
    await clearCustomerSessionCookie();
    const account = await ensureAccountForCurrentPrincipal();

    // A blocked account holds a valid credential and no access. Ending the
    // session here rather than letting the layout bounce them means the state
    // is actually cleared, not merely hidden behind a redirect.
    if (isAccountLockedOut(account.status)) {
      await signOut();
      recordPipelineEvent({
        pipeline: "auth",
        operation: "auth.sign_in",
        status: "failed",
        message: "Sign-in refused: the account is not active",
        userId: account.userId,
        errorMessage: `Account status is ${account.status}.`,
      });
      return {
        ok: false,
        message: `This account is ${account.status}. Contact support.`,
        redirectTo: "/login",
      };
    }

    await recordSignIn(account.userId);
    recordPipelineEvent({
      pipeline: "auth",
      operation: "auth.sign_in",
      status: "ok",
      message: "Signed in and resolved to an application account",
      userId: account.userId,
    });

    // Only same-origin paths. An open redirect on the sign-in route is how a
    // phishing page borrows a real domain's credibility.
    const requested = input.next ?? "/";
    const safeNext =
      requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

    return {
      ok: true,
      message: "Signed in.",
      redirectTo: account.profileComplete ? safeNext : "/complete-profile",
    };
  } catch (error) {
    /*
     * THE CREDENTIAL WAS ALREADY ACCEPTED BEFORE THIS FUNCTION RAN.
     *
     * The browser authenticated with Supabase and holds a session cookie; all
     * this does is resolve or create the matching `public.users` row. So a
     * throw here is not a verdict about the person — it is almost always the
     * pooler refusing a connection (`(EMAXCONNSESSION) max clients reached in
     * session mode`, observed on this project) or a query timing out.
     *
     * It used to be returned verbatim, so a database fault appeared on the
     * sign-in form as the reason sign-in failed, complete with Drizzle's SQL.
     * `toSafeFailure` keeps the real text in the system log and gives the
     * person something true and actionable instead.
     *
     * Nothing is granted either way: a failed sign-in still returns `ok: false`
     * and the gate in `(app)/layout.tsx` still resolves the account itself on
     * the next request.
     */
    const failure = toSafeFailure(
      error,
      "Could not complete sign-in. Please try again.",
    );

    recordPipelineEvent({
      pipeline: "auth",
      operation: "auth.sign_in",
      status: "failed",
      message: isInfrastructureFailure(error)
        ? "Sign-in could not complete — the account store was unreachable"
        : "Could not resolve an application account for a valid session",
      errorMessage: describeError(error),
      metadata: {
        errorCategory: failure.category,
        retryable: failure.retryable,
        ...errorDiagnostics(error),
      },
    });

    return {
      ok: false,
      retryable: failure.retryable,
      message: failure.message,
      redirectTo: "/login",
    };
  }
}
