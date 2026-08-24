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

  // Already signed in: nothing to do here. A locked-out account is the one
  // exception — it holds a session and must stay on this page to be told why.
  const account = await getAuthenticatedAccount();
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
