"use server";

import { redirect } from "next/navigation";

import { getCurrentOperator } from "@/server/admin/session";
import { signOut } from "@/server/auth/session";

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
 */
export async function completeOperatorSignIn(): Promise<{
  ok: boolean;
  message: string;
}> {
  try {
    const operator = await getCurrentOperator();
    if (!operator) {
      return {
        ok: false,
        message:
          "That account is not an operator on this platform. Ask a master admin to provision access.",
      };
    }
    return { ok: true, message: `Signed in as ${operator.name}.` };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not verify operator access.",
    };
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
