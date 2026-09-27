"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  inMemoryPersistence,
  setPersistence,
  type Auth,
} from "firebase/auth";

import { getFirebaseWebConfig } from "./config";

/**
 * The browser's Firebase Auth instance, for phone OTP only.
 *
 * FIREBASE PROVES THE PHONE; THE SERVER HOLDS THE SESSION
 * -------------------------------------------------------
 * The browser uses Firebase for exactly one thing: sending an SMS code and
 * verifying it, which yields a short-lived ID token. That token is handed to a
 * server action once, exchanged for an httpOnly session cookie, and the
 * browser-side Firebase user is signed out again.
 *
 * Hence `inMemoryPersistence`. Firebase's default keeps the user — including a
 * long-lived refresh token — in IndexedDB, readable by any script on the
 * origin. Nothing here needs it after the exchange: the session is the
 * httpOnly cookie JavaScript cannot read, which is also what makes a signed-in
 * state survive closing and reopening the installed app.
 */
let authPromise: Promise<Auth> | null = null;

export function getFirebaseAuth(): Promise<Auth> {
  if (authPromise) return authPromise;

  const config = getFirebaseWebConfig();
  if (!config) {
    return Promise.reject(new Error("Phone sign-in is not configured."));
  }

  authPromise = (async () => {
    const app: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(config);
    const auth = getAuth(app);
    await setPersistence(auth, inMemoryPersistence);
    // The SMS template and reCAPTCHA follow the device language.
    auth.useDeviceLanguage();
    return auth;
  })().catch((error) => {
    // A failed initialisation must not be cached forever.
    authPromise = null;
    throw error;
  });

  return authPromise;
}

/**
 * Maps a Firebase client error to something a person may be shown.
 *
 * Firebase's own messages name internal codes and occasionally quota details;
 * none of that helps somebody holding a phone, and "user not found"-style
 * distinctions would leak account existence. Everything collapses to a
 * handful of true, actionable sentences.
 */
export function describePhoneAuthError(
  error: unknown,
  stage: "send" | "verify",
): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";

  if (stage === "verify") {
    if (code === "auth/code-expired") return "Invalid or expired OTP.";
    if (code === "auth/invalid-verification-code" || code === "auth/missing-code") {
      return "Invalid or expired OTP.";
    }
  }
  if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  if (code === "auth/invalid-phone-number" || code === "auth/missing-phone-number") {
    return "Enter a valid 10-digit Indian mobile number.";
  }
  if (code === "auth/network-request-failed") {
    return "Network problem. Check your connection and try again.";
  }
  return stage === "send"
    ? "Unable to send OTP. Please try again."
    : "Invalid or expired OTP.";
}
