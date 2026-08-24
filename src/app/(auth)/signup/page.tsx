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
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const account = await getAuthenticatedAccount();
  if (account) {
    redirect(account.profileComplete ? (next ?? "/") : "/complete-profile");
  }

  return <SignUpForm configured={isAuthConfigured()} next={next ?? "/"} />;
}
