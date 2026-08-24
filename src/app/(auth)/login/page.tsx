import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import { isAuthConfigured } from "@/lib/supabase/env";
import { getAuthenticatedAccount, isAccountLockedOut } from "@/server/auth/account";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Nanotron with your email and password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  /*
   * Already signed in: nothing to do here. A locked-out account is the one
   * exception — it holds a session and must stay on this page to be told why.
   *
   * WHY THIS IS ALLOWED TO FAIL QUIETLY
   * -----------------------------------
   * This lookup is a **convenience**: it saves an already-signed-in visitor a
   * click. The sign-in form is the recovery path for everything else, so it
   * must render even when the account cannot be resolved — during a database
   * outage, or when the auth provider is briefly unreachable.
   *
   * Letting the error propagate made `/login` itself return 500 while the
   * database was down (measured), which is the worst possible moment to lose
   * the one page a stuck user is told to go to. Falling back to "show the
   * form" costs a signed-in visitor one redirect they would have got for free
   * and costs everyone else nothing.
   *
   * No security property changes: this branch only ever *skips* a redirect.
   * The gate that protects account data is in `(app)/layout.tsx`, and it
   * still refuses when the session cannot be resolved.
   */
  const account = await convenienceLookup(() => getAuthenticatedAccount());

  if (account && !isAccountLockedOut(account.status)) {
    redirect(account.profileComplete ? (next ?? "/") : "/complete-profile");
  }

  return (
    <SignInForm
      configured={isAuthConfigured()}
      next={next ?? "/"}
      initialError={
        error ??
        (account ? `This account is ${account.status}. Contact support.` : undefined)
      }
    />
  );
}

/**
 * A lookup whose *answer* is optional, bounded by its own short deadline.
 *
 * The read-level deadline in `@/server/database` is sized for a page that
 * cannot render without its data — long enough to survive a slow round trip and
 * a connection retry. That is the wrong budget here: this page renders fine
 * with no answer at all, and the only thing waiting achieves is delaying the
 * one screen a stuck user has been told to go to.
 *
 * Measured with the database blackholed: `/login` took 8.6s to fall back before
 * this, and the underlying read can legitimately take ~12s in production once
 * the connection retry is included. Two seconds is well beyond a healthy
 * lookup (~400ms) and far below either.
 *
 * Returning null on timeout is the same outcome as "not signed in", which is
 * the correct default for a sign-in page: it shows the form. The dangling
 * promise is claimed so a later rejection cannot surface as an unhandled one.
 */
async function convenienceLookup<T>(read: () => Promise<T>): Promise<T | null> {
  const CONVENIENCE_TIMEOUT_MS = 2_000;

  const pending = read().catch(() => null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), CONVENIENCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([pending, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
