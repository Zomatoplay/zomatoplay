import "server-only";

import { isFirebaseWebConfigured } from "@/lib/firebase/config";
import { isAuthConfigured } from "@/lib/supabase/env";

import { isCustomerSessionConfigured } from "./customer-session";
import { isFirebaseVerifierConfigured } from "./firebase-admin";

/**
 * Whether phone OTP is the live customer sign-in.
 *
 * Three things are needed: the browser config to send a code, the project id
 * to verify the result, and the session secret to turn it into a session.
 * With any missing, `/login` says customer sign-in is not configured rather
 * than showing a flow that cannot complete. No Firebase service-account key is
 * involved (`firebase-admin.ts`).
 */
export function isPhoneSignInLive(): boolean {
  return (
    isFirebaseWebConfigured() && isFirebaseVerifierConfigured() && isCustomerSessionConfigured()
  );
}

/**
 * Whether the old customer email sign-in is offered at all.
 *
 * Customers sign in by mobile number. The email pages (`/login/email`,
 * `/signup`, `/forgot-password`) and `completeSignIn` are kept in the codebase
 * but switched off unless `LEGACY_EMAIL_SIGN_IN=true`: an existing customer
 * whose account predates phone sign-in needs one email sign-in to link a
 * verified number (`/link-phone`), and whether any such customer exists on a
 * given database is a fact about that database, not about this code. Turn it
 * on for a migration window, off again afterwards.
 *
 * Operators are unaffected: they authenticate through `/admin/login`, which
 * does not read this (§20), and `/update-password` stays open because operator
 * password resets land there.
 */
export function isLegacyEmailSignInEnabled(): boolean {
  return process.env.LEGACY_EMAIL_SIGN_IN === "true" && isAuthConfigured();
}
