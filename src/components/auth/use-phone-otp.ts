"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from "firebase/auth";

import { describePhoneAuthError, getFirebaseAuth } from "@/lib/firebase/client";
import { startLocalPhoneProofAction } from "@/app/phone-proof-actions";
import type { PhoneProof, PhoneProofPurpose } from "@/types";

/**
 * Send an SMS code to a number, check it, and hand back a proof for the
 * server — the browser half of operator sign-in and withdrawal-password setup.
 *
 * Firebase sends the SMS and checks the code; this hook only relays. The
 * Firebase ID token it returns is short-lived and verified server-side
 * (`verifyPhoneProof`); the browser-side Firebase user is signed out straight
 * away and was only ever held in memory (`getFirebaseAuth`).
 *
 * The resend cooldown and the five-wrong-codes cap are courtesies that keep an
 * honest person from burning Firebase's per-number quota; the real limits are
 * Firebase's and the server actions' own.
 *
 * `localTest` is set only by a page rendered by `next dev` on localhost with
 * `DEV_TEST_AUTH=true`. Entering exactly that number takes the local test path;
 * the server re-checks every gate when the proof is spent.
 *
 * Customer sign-in (`PhoneOtpForm`) predates this hook and keeps its own copy
 * of the Firebase steps.
 */

const RESEND_COOLDOWN_S = 60;
const MAX_CODE_ATTEMPTS = 5;

export function usePhoneOtp({
  purpose,
  localTest = null,
}: {
  purpose: PhoneProofPurpose;
  localTest?: { phoneE164: string } | null;
}) {
  const recaptchaRef = useRef<HTMLDivElement | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const localChallenge = useRef<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // The reCAPTCHA widget is tied to a DOM node; release it with the component.
  useEffect(
    () => () => {
      verifier.current?.clear();
      verifier.current = null;
    },
    [],
  );

  const sent = useCallback((target: string) => {
    setSentTo(target);
    setAttempts(0);
    setCooldown(RESEND_COOLDOWN_S);
  }, []);

  /** Sends a code to `phoneE164`. Resolves true when a code is on its way. */
  async function send(phoneE164: string): Promise<boolean> {
    if (sending) return false;
    setSending(true);
    setError(null);
    confirmation.current = null;
    localChallenge.current = null;
    try {
      if (localTest && phoneE164 === localTest.phoneE164) {
        const started = await startLocalPhoneProofAction({ phone: phoneE164, purpose }).catch(() => null);
        if (!started?.ok || !started.challenge) {
          setError(started?.message ?? "Unable to send OTP. Please try again.");
          return false;
        }
        localChallenge.current = started.challenge;
        sent(phoneE164);
        return true;
      }

      const auth = await getFirebaseAuth();
      if (!verifier.current) {
        if (!recaptchaRef.current) throw new Error("reCAPTCHA container is not mounted.");
        verifier.current = new RecaptchaVerifier(auth, recaptchaRef.current, { size: "invisible" });
      }
      confirmation.current = await signInWithPhoneNumber(auth, phoneE164, verifier.current);
      sent(phoneE164);
      return true;
    } catch (caught) {
      // A used or failed reCAPTCHA cannot be reused; the next attempt gets a
      // fresh one.
      verifier.current?.clear();
      verifier.current = null;
      setError(describePhoneAuthError(caught, "send"));
      return false;
    } finally {
      setSending(false);
    }
  }

  /** Checks `code` and returns the proof to send to the server, or null. */
  async function verify(code: string): Promise<PhoneProof | null> {
    if (verifying || !sentTo) return null;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit OTP.");
      return null;
    }
    setError(null);

    if (localChallenge.current) {
      return { kind: "local-test", phone: sentTo, code, challenge: localChallenge.current };
    }
    if (!confirmation.current) {
      setError("Request a new OTP.");
      return null;
    }

    setVerifying(true);
    try {
      const credential = await confirmation.current.confirm(code);
      const idToken = await credential.user.getIdToken();
      // The server verifies the token on its own; the browser user has no
      // further use and is not kept.
      void getFirebaseAuth().then((auth) => signOut(auth)).catch(() => {});
      confirmation.current = null;
      return { kind: "firebase", idToken };
    } catch (caught) {
      const used = attempts + 1;
      setAttempts(used);
      if (used >= MAX_CODE_ATTEMPTS) {
        confirmation.current = null;
        setError("Too many incorrect attempts. Request a new OTP.");
      } else {
        setError(describePhoneAuthError(caught, "verify"));
      }
      return null;
    } finally {
      setVerifying(false);
    }
  }

  /** Back to the start — a different number, or after a spent proof. */
  function reset() {
    confirmation.current = null;
    localChallenge.current = null;
    setSentTo(null);
    setError(null);
  }

  return {
    recaptchaRef,
    sentTo,
    sending,
    verifying,
    cooldown,
    error,
    setError,
    send,
    verify,
    reset,
  };
}
