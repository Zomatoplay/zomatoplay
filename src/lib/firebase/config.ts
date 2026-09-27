/**
 * The public Firebase web configuration.
 *
 * PUBLIC BY DESIGN, AND THAT IS NOT A LOOPHOLE
 * --------------------------------------------
 * A Firebase web `apiKey` identifies the project to Google; it authorises
 * nothing on its own. What stops abuse of phone sign-in is configured in the
 * Firebase console — the authorised-domain list, the SMS region policy
 * (India only), App Check / reCAPTCHA — never secrecy of these values. They
 * are inlined into the browser bundle at build time, which is why each is read
 * by its literal `process.env.NEXT_PUBLIC_…` name: Next only inlines a
 * reference it can see.
 *
 * The server needs no Firebase credential at all — it verifies ID tokens with
 * the project id (`@/server/auth/firebase-admin`) and signs its own session
 * with `CUSTOMER_SESSION_SECRET`, which is server-only and never
 * `NEXT_PUBLIC_`.
 */

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

export function getFirebaseWebConfig(): FirebaseWebConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();

  // The four phone sign-in cannot work without. The other two are optional
  // for Auth and passed through when present.
  if (!apiKey || !authDomain || !projectId || !appId) return null;

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim() || undefined,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
  };
}

/** Whether the browser half of phone sign-in is configured. */
export function isFirebaseWebConfigured(): boolean {
  return getFirebaseWebConfig() !== null;
}
