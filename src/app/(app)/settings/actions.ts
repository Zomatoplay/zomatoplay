"use server";

import { redirect } from "next/navigation";

import { endCustomerSessions, getAuthenticatedAccount } from "@/server/auth/account";
import { clearCustomerSessionCookie } from "@/server/auth/customer-session";
import { signOut } from "@/server/auth/session";

/**
 * Ends the session — both kinds.
 *
 * The phone session: the account's `session_epoch` is advanced, which ends
 * every phone session it holds on every device — a copied cookie stops working
 * on its next request — and this browser's cookie is cleared. If the account
 * cannot be resolved (database unreachable), the cookie is still cleared:
 * this session ends, which is what the person asked for.
 *
 * The legacy Supabase session is ended as before.
 *
 * The redirect matters just as much in practice, because every cached Server
 * Component payload in the tab was rendered for the account that is leaving.
 * Landing on the sign-in route discards it rather than leaving one person's
 * balance on screen for the next.
 */
export async function signOutAction(): Promise<never> {
  try {
    const account = await getAuthenticatedAccount();
    if (account?.signInMethod === "phone") await endCustomerSessions(account.userId);
  } catch {
    // Best-effort beyond this browser; the cookie below is cleared regardless.
  }
  await clearCustomerSessionCookie();

  try {
    await signOut();
  } catch {
    // No legacy session, or Supabase unreachable — either way nothing to end.
  }
  redirect("/login");
}
