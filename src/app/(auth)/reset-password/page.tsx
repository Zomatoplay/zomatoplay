import { redirect } from "next/navigation";

/**
 * The old path for the password-update screen.
 *
 * Kept because recovery emails already sent point here, and those links are
 * single-use: letting one 404 would consume the code and strand the person with
 * no way to retry. The recovery session is already established by the callback
 * before this runs, so the redirect carries it.
 */
export default function LegacyResetPasswordPage() {
  redirect("/update-password");
}
