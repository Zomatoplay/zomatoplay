import type { Metadata } from "next";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { isAuthConfigured } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "Forgot password",
  description: "Request a password reset link for your Nanotron account.",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm configured={isAuthConfigured()} />;
}
