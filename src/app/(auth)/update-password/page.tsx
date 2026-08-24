import type { Metadata } from "next";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getAuthPrincipal } from "@/server/auth/session";

export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Never prerendered: whether the form is usable depends on the recovery session
 * in the request's cookies.
 */
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const principal = await getAuthPrincipal();
  return <ResetPasswordForm hasSession={Boolean(principal)} />;
}
