"use server";

import { redirect } from "next/navigation";

import { signOut } from "@/server/auth/session";

/**
 * Ends the session.
 *
 * Clearing the Supabase cookie is what actually signs the user out; the
 * redirect matters just as much in practice, because every cached Server
 * Component payload in the tab was rendered for the account that is leaving.
 * Landing on the sign-in route discards it rather than leaving one person's
 * balance on screen for the next.
 */
export async function signOutAction(): Promise<never> {
  await signOut();
  redirect("/login");
}
