"use server";

import { redirect } from "next/navigation";

import { getCurrentOperator } from "@/server/admin/session";
import { signOut } from "@/server/auth/session";
import { isInfrastructureFailure, toSafeFailure } from "@/server/errors";
import { describeError, errorDiagnostics, recordPipelineEvent } from "@/server/observability";
import { traceAction } from "@/server/trace-action";

/**
 * Confirms that the freshly authenticated principal is an operator.
 *
 * A valid Supabase session says who somebody is, not what they may do here. An
 * ordinary customer signing in with their own perfectly good password must not
 * end up inside the CRM, so the operator lookup happens server-side and its
 * answer is the gate.
 *
 * Takes no arguments for the same reason every action in this codebase does
 * not: there is nothing the browser could send that would be trusted.
 *
 * AN UNREACHABLE DATABASE IS NOT A REFUSED SIGN-IN
 * ------------------------------------------------
 * This used to `catch (error)` and return `{ ok: false, message: error.message }`
 * for *anything*. When the Supabase session pooler refused a connection —
 * `(EMAXCONNSESSION) max clients reached in session mode`, five times in a row
 * on 2026-09-14 — the operator was shown Drizzle's raw "Failed query: select
 * …admin_agents… params: <uuid>" and told their sign-in had failed. Two
 * separate defects in one line: an infrastructure fault reported as an
 * authorization verdict, and internal SQL rendered in a browser.
 *
 * The three outcomes are now distinct, and the distinction is the whole fix:
 *
 *   ok: true                        — this principal is an operator
 *   ok: false, retryable: false     — a verdict: not an operator, or disabled
 *   ok: false, retryable: true      — no verdict was reached; try again
 *
 * **It still grants nothing on failure.** `retryable` changes what the form
 * says and whether it offers a retry; it never lets anybody through. The gate
 * is `(console)/layout.tsx`, which resolves the operator again on every
 * request and refuses when it cannot.
 */
export interface OperatorSignInResult {
  ok: boolean;
  message: string;
  /** True when the attempt failed for a reason that may clear on its own. */
  retryable?: boolean;
}

export async function completeOperatorSignIn(): Promise<OperatorSignInResult> {
  return traceAction(
    { name: "admin.sign_in", actorType: "admin", pipeline: "admin" },
    resolveOperatorSignIn,
  );
}

async function resolveOperatorSignIn(): Promise<OperatorSignInResult> {
  try {
    const operator = await getCurrentOperator();

    if (!operator) {
      /*
       * A real verdict, and the common one: a valid Supabase session belonging
       * to somebody who is not an operator. Recorded as `ok` rather than
       * `failed`, because nothing went wrong — the system produced the answer
       * it is designed to produce.
       */
      recordPipelineEvent({
        pipeline: "admin",
        operation: "admin.sign_in.refused",
        status: "ok",
        message: "A valid session that belongs to no operator row",
      });
      return {
        ok: false,
        retryable: false,
        message:
          "That account is not an operator on this platform. Ask a master admin to provision access.",
      };
    }

    recordPipelineEvent({
      pipeline: "admin",
      operation: "admin.sign_in.granted",
      status: "ok",
      message: "Operator session established",
      actor: operator.actor,
    });
    return { ok: true, message: `Signed in as ${operator.name}.` };
  } catch (error) {
    const failure = toSafeFailure(
      error,
      "Could not verify operator access. Try again.",
    );

    recordPipelineEvent({
      pipeline: "admin",
      operation: "admin.sign_in.failed",
      status: "failed",
      message: isInfrastructureFailure(error)
        ? "Operator lookup could not complete — infrastructure, not a verdict"
        : "Operator sign-in was refused",
      // The full cause chain, so the SQLSTATE behind a "Failed query:" wrapper
      // is in the system log even though it never reaches the browser.
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
 * Ends the operator session.
 *
 * The same Supabase sign-out the user application performs — one credential
 * store, one way out of it. The redirect matters as much as the cookie: every
 * cached Server Component payload in the tab was rendered for the operator who
 * is leaving, and some of it is other people's identity documents.
 */
export async function signOutOperator(): Promise<never> {
  await signOut();
  redirect("/admin/login");
}
