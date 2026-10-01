import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthLogo, AuthSupportLink } from "@/components/auth/auth-shared";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { isAuthConfigured } from "@/lib/supabase/env";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { isLegacyEmailSignInEnabled, isPhoneSignInLive } from "@/server/auth/phone-sign-in";
import { getSupportTelegramUrl } from "@/server/services/catalogue.service";
import { APP_NAME } from "@/constants/app";

export const metadata: Metadata = {
  title: "Create account",
  description: `Create a ${APP_NAME} account with your email address.`,
};

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; ref?: string }>;
}) {
  const { next, ref } = await searchParams;

  // New customers register by mobile number. The middleware has already
  // captured any `ref` code into its cookie, and passing it along keeps the
  // link intact either way. Email registration exists only while the legacy
  // switch is on and phone sign-in is not live.
  if (isPhoneSignInLive() || !isLegacyEmailSignInEnabled()) {
    const params = new URLSearchParams();
    if (next) params.set("next", next);
    if (ref) params.set("ref", ref);
    const query = params.toString();
    redirect(query ? `/login?${query}` : "/login");
  }

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

  // Optional on this screen: a lookup that fails must not take the sign-up
  // form down with it, so it degrades to the support mailbox (or nothing).
  const telegramUrl = await getSupportTelegramUrl().catch(() => null);

  return (
    <div className="space-y-6">
      <AuthLogo />
      <SignUpForm
        configured={isAuthConfigured()}
        next={next ?? "/"}
        referralCode={referralCode}
      />
      <AuthSupportLink telegramUrl={telegramUrl} />
    </div>
  );
}
