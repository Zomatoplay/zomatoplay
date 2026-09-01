import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SignUpForm } from "@/components/auth/sign-up-form";
import { isAuthConfigured } from "@/lib/supabase/env";
import { getAuthenticatedAccount } from "@/server/auth/account";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create a Nanotron account with your email address.",
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; ref?: string }>;
}) {
  const { next, ref } = await searchParams;

  const account = await getAuthenticatedAccount();
  if (account) {
    redirect(account.profileComplete ? (next ?? "/") : "/complete-profile");
  }

  /*
   * Shown, not just stored.
   *
   * The middleware has already captured `?ref=` into the cookie that actually
   * decides attribution; this only prefills the field so somebody arriving by
   * an invite link can see which invite they are signing up under. It is
   * display text, validated for shape so a crafted URL cannot put arbitrary
   * content into the form.
   */
  const referralCode =
    ref && /^[A-Za-z0-9]{4,32}$/.test(ref.trim()) ? ref.trim().toUpperCase() : "";

  return (
    <SignUpForm
      configured={isAuthConfigured()}
      next={next ?? "/"}
      referralCode={referralCode}
    />
  );
}
