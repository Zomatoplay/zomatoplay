"use server";

import { ensureAccountForCurrentPrincipal, isAccountLockedOut } from "@/server/auth/account";
import { signOut } from "@/server/auth/session";
import { recordSignIn } from "@/server/auth/sign-in-record";
import { recordPipelineEvent } from "@/server/observability";
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
    recordPipelineEvent({
      pipeline: "auth",
      operation: "auth.sign_in",
      status: "failed",
      message: "Could not resolve an application account for a valid session",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Could not complete sign-in. Please try again.",
      redirectTo: "/login",
    };
  }
}
