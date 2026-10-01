import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminSignInForm } from "@/components/admin/layout/admin-sign-in-form";
import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { isOperatorSessionConfigured } from "@/server/admin/operator-session";
import { getCurrentOperator } from "@/server/admin/session";
import { localTestOperator } from "@/server/auth/dev-test-gate";
import { isFirebaseVerifierConfigured } from "@/server/auth/firebase-admin";

export const metadata: Metadata = {
  title: "Operator sign-in",
  robots: { index: false, follow: false },
};

/** Never prerendered: what it renders depends on the request's session. */
export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  let refusal = reason;
  let operator: Awaited<ReturnType<typeof getCurrentOperator>> = null;

  try {
    operator = await getCurrentOperator();
  } catch (error) {
    // A disabled operator account. Say so here rather than looping.
    if (error instanceof Error && error.name === "AdminAuthorizationError") {
      refusal = error.message;
    }
    /*
     * Anything else is infrastructure — the database unreachable, the auth
     * provider briefly down — and it used to be re-thrown, which turned the
     * operator sign-in page into a 500 during exactly the outage an operator
     * would be signing in to investigate.
     *
     * Resolving the operator here only decides whether to skip the form. It
     * grants nothing: the console's gate is `(console)/layout.tsx`, which
     * still refuses when the session cannot be resolved. So the safe
     * degradation is to show the sign-in form.
     */
  }

  /*
   * Outside the `try`, and that is load-bearing.
   *
   * `redirect()` works by throwing a signal Next catches. Called inside the
   * block above it would be swallowed by the very catch that is there to
   * tolerate infrastructure failures, and an authenticated operator would be
   * shown the sign-in form forever instead of the console.
   */
  if (operator) redirect("/admin");

  // Development build on localhost with DEV_TEST_AUTH=true only; null otherwise.
  const localTest = await localTestOperator();

  return (
    <AdminSignInForm
      configured={
        (isFirebaseWebConfigured() || Boolean(localTest)) &&
        isFirebaseVerifierConfigured() &&
        isOperatorSessionConfigured()
      }
      reason={refusal}
      localTest={localTest ? { phoneE164: localTest.phoneE164 } : null}
    />
  );
}
