import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthFooterLink } from "@/components/auth/auth-shared";
import { PhoneOtpForm } from "@/components/auth/phone-otp-form";
import { getAuthenticatedAccount, isAccountLockedOut } from "@/server/auth/account";
import { localTestCustomer } from "@/server/auth/dev-test-gate";
import { isLegacyEmailSignInEnabled, isPhoneSignInLive } from "@/server/auth/phone-sign-in";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to Nanotron with your mobile number.",
};

/**
 * Customer sign-in: mobile number and a one-time code (Firebase phone auth).
 *
 * An already-signed-in visitor is sent on, as before; the lookup is a
 * convenience and may fail quietly, because this page is the recovery path
 * for everything else (see `convenienceLookup`).
 *
 * When phone sign-in is not configured on this deployment the page says so
 * plainly rather than showing a form that would send a code to nobody. The
 * legacy email link appears only while `LEGACY_EMAIL_SIGN_IN=true`.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  const account = await convenienceLookup(() => getAuthenticatedAccount());
  if (account && !isAccountLockedOut(account.status)) {
    redirect(account.profileComplete ? safeNext : "/complete-profile");
  }

  const lockedOut = account ? `This account is ${account.status}. Contact support.` : null;
  const phoneLive = isPhoneSignInLive();
  const legacyEmail = isLegacyEmailSignInEnabled();
  // Development build on localhost with DEV_TEST_AUTH=true only; null otherwise.
  const localTest = await localTestCustomer();

  return (
    <div className="space-y-6">
      {error || lockedOut ? (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive"
          role="alert"
        >
          {lockedOut ?? error}
        </p>
      ) : null}

      {phoneLive || localTest ? (
        <PhoneOtpForm
          mode="sign-in"
          next={safeNext}
          localTest={localTest ? { phoneE164: localTest.phoneE164 } : null}
        />
      ) : (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight">
            Mobile sign-in is not available yet
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Sign-in by mobile number has not been configured on this deployment.
            Please try again later.
          </p>
        </div>
      )}

      {legacyEmail ? (
        <AuthFooterLink
          prompt="Signed up with email before?"
          href={`/login/email?next=${encodeURIComponent(safeNext)}`}
          label="Sign in with email"
        />
      ) : null}
    </div>
  );
}

/**
 * A lookup whose answer is optional, bounded by its own short deadline — the
 * sign-in page must render during a database outage, which is exactly when a
 * stuck customer is sent here. Returns null (show the form) on timeout.
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
