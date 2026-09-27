import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PhoneOtpForm } from "@/components/auth/phone-otp-form";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { isPhoneSignInLive } from "@/server/auth/phone-sign-in";

export const metadata: Metadata = { title: "Verify your mobile number" };

// Per request, never prerendered: whether phone sign-in is live is read from
// the runtime environment, and a build without Firebase credentials would
// otherwise bake in a permanent redirect.
export const dynamic = "force-dynamic";

/**
 * The one-time migration step for an account that predates phone sign-in.
 *
 * Reached from the app gate when somebody signs in by email and their account
 * has no verified number. They verify one by OTP; `linkPhoneAction` attaches
 * it to THIS account — the one their email session already owns — and never
 * to any other (`decidePhoneLink`). From then on they sign in by phone.
 */
export default async function LinkPhonePage() {
  if (!isPhoneSignInLive()) redirect("/");

  const account = await getAuthenticatedAccount();
  if (!account) redirect("/login");
  // Already on a phone session, or already linked: nothing to do here.
  if (account.signInMethod === "phone" || account.firebaseUid) redirect("/");

  return <PhoneOtpForm mode="link" />;
}
