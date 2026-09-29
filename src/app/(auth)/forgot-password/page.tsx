import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { isAuthConfigured } from "@/lib/supabase/env";
import { isLegacyEmailSignInEnabled } from "@/server/auth/phone-sign-in";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a password reset link for your Nanotron account.",
};

/** Per request: the legacy switch is read from the runtime environment. */
export const dynamic = "force-dynamic";

/**
 * Customer password reset — part of the legacy email sign-in, off unless
 * `LEGACY_EMAIL_SIGN_IN=true`. Customers sign in by mobile number and have no
 * password. (Operators reset through the CRM, which lands on
 * `/update-password`, not here.)
 */
export default function ForgotPasswordPage() {
  if (!isLegacyEmailSignInEnabled()) redirect("/login");
  return <ForgotPasswordForm configured={isAuthConfigured()} />;
}
