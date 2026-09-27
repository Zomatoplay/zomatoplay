import "server-only";

import { isFirebaseWebConfigured } from "@/lib/firebase/config";

import { isCustomerSessionConfigured } from "./customer-session";
import { isFirebaseVerifierConfigured } from "./firebase-admin";

/**
 * Whether phone OTP is the live customer sign-in.
 *
 * Three things are needed: the browser config to send a code, the project id
 * to verify the result, and the session secret to turn it into a session.
 * With any missing the application stays on legacy email sign-in rather than
 * forcing customers into a flow that cannot complete — and says so on
 * `/login`. No Firebase service-account key is involved (`firebase-admin.ts`).
 */
export function isPhoneSignInLive(): boolean {
  return (
    isFirebaseWebConfigured() && isFirebaseVerifierConfigured() && isCustomerSessionConfigured()
  );
}
