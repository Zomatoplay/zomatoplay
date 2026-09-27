"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import {
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from "firebase/auth";

import { AuthHeading } from "@/components/auth/auth-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describePhoneAuthError, getFirebaseAuth } from "@/lib/firebase/client";
import { maskIndianMobile, normalizeIndianMobile } from "@/lib/phone";
import {
  completePhoneSignInAction,
  linkPhoneAction,
  type PhoneAuthResult,
} from "@/app/(auth)/login/phone-actions";

/**
 * Mobile number → OTP → signed in.
 *
 * WHAT THE BROWSER DOES AND DOES NOT DECIDE
 * -----------------------------------------
 * Firebase sends the SMS and checks the code; this component only relays. The
 * result is a short-lived ID token, handed once to a server action that
 * verifies it and sets an httpOnly session cookie. The browser-side Firebase
 * user is then signed out again (and was only ever held in memory — see
 * `getFirebaseAuth`), so no credential is left in browser storage.
 *
 * ABUSE LIMITS HERE ARE COURTESIES
 * --------------------------------
 * The resend cooldown and the five-wrong-codes cap keep an honest person from
 * burning through Firebase's per-number quota by accident. The real limits are
 * Firebase's (per number, per project, reCAPTCHA) and the server action's
 * per-address window; nothing here is trusted to enforce anything.
 *
 * `mode="link"` is the migration path for an existing email customer: same
 * OTP, but the server attaches the number to the account they are already
 * signed in to instead of resolving one.
 */

const RESEND_COOLDOWN_S = 60;
const MAX_CODE_ATTEMPTS = 5;
const RECAPTCHA_CONTAINER_ID = "phone-otp-recaptcha";

type Stage = "phone" | "code";

export function PhoneOtpForm({
  mode,
  next = "/",
}: {
  mode: "sign-in" | "link";
  next?: string;
}) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [pending, startTransition] = useTransition();
  const [cooldown, setCooldown] = useState(0);
  const [attempts, setAttempts] = useState(0);

  const confirmation = useRef<ConfirmationResult | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const sentTo = useRef<string | null>(null);

  const phoneE164 = normalizeIndianMobile(phoneInput);
  const busy = sending || verifying || pending;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // The reCAPTCHA widget is tied to a DOM node; release it with the component.
  useEffect(() => {
    return () => {
      verifier.current?.clear();
      verifier.current = null;
    };
  }, []);

  async function sendCode(target: string) {
    setSending(true);
    setError(null);
    try {
      const auth = await getFirebaseAuth();
      if (!verifier.current) {
        verifier.current = new RecaptchaVerifier(auth, RECAPTCHA_CONTAINER_ID, {
          size: "invisible",
        });
      }
      confirmation.current = await signInWithPhoneNumber(auth, target, verifier.current);
      sentTo.current = target;
      setStage("code");
      setCode("");
      setAttempts(0);
      setCooldown(RESEND_COOLDOWN_S);
    } catch (caught) {
      // A used or failed reCAPTCHA cannot be reused; the next attempt gets a
      // fresh one.
      verifier.current?.clear();
      verifier.current = null;
      setError(describePhoneAuthError(caught, "send"));
    } finally {
      setSending(false);
    }
  }

  function onSubmitPhone(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (!phoneE164) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    void sendCode(phoneE164);
  }

  async function onSubmitCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !confirmation.current) return;
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit OTP.");
      return;
    }

    setVerifying(true);
    setError(null);
    let idToken: string;
    try {
      const credential = await confirmation.current.confirm(code);
      idToken = await credential.user.getIdToken();
    } catch (caught) {
      const used = attempts + 1;
      setAttempts(used);
      if (used >= MAX_CODE_ATTEMPTS) {
        confirmation.current = null;
        setError("Too many incorrect attempts. Request a new OTP.");
      } else {
        setError(describePhoneAuthError(caught, "verify"));
      }
      setVerifying(false);
      return;
    }

    let result: PhoneAuthResult;
    try {
      result =
        mode === "link"
          ? await linkPhoneAction({ idToken })
          : await completePhoneSignInAction({ idToken, next });
    } catch {
      result = { ok: false, message: "Unable to sign in. Please try again." };
    } finally {
      // The server now holds the session (or refused to). The browser-side
      // Firebase user has no further use either way.
      void getFirebaseAuth().then((auth) => signOut(auth)).catch(() => {});
      setVerifying(false);
    }

    if (!result.ok) {
      setError(result.message);
      // A refused sign-in needs a fresh code: this one has been spent.
      confirmation.current = null;
      return;
    }

    startTransition(() => {
      router.replace(result.redirectTo ?? "/");
      router.refresh();
    });
  }

  function changeNumber() {
    confirmation.current = null;
    setStage("phone");
    setCode("");
    setError(null);
  }

  const heading =
    mode === "link"
      ? { title: "Verify your mobile number", subtitle: "Nanotron now signs you in with your mobile number. Verify it once to keep using your account." }
      : { title: "Welcome back", subtitle: "Enter your mobile number" };

  return (
    <div className="space-y-6">
      {stage === "phone" ? (
        <>
          <AuthHeading title={heading.title} subtitle={heading.subtitle} />
          <form onSubmit={onSubmitPhone} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="phone-number">Mobile number</Label>
              <div className="flex items-stretch gap-2">
                <span
                  className="flex h-11 shrink-0 items-center rounded-full border border-border bg-secondary px-3.5 text-base font-medium text-foreground tabular"
                  aria-hidden
                >
                  +91
                </span>
                <Input
                  id="phone-number"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  maxLength={14}
                  className="h-11 text-base tabular"
                  value={phoneInput}
                  onChange={(event) => setPhoneInput(event.target.value)}
                  aria-describedby="phone-help"
                  aria-invalid={error ? true : undefined}
                />
              </div>
              <p id="phone-help" className="text-xs leading-relaxed text-muted-foreground">
                We&rsquo;ll send a one-time code by SMS. Standard SMS rates may apply.
              </p>
            </div>

            {error ? (
              <p className="text-sm leading-relaxed text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button type="submit" variant="brand" size="lg" block disabled={busy}>
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Smartphone className="size-4" aria-hidden />
              )}
              {sending ? "Sending OTP…" : "Send OTP"}
            </Button>
          </form>
        </>
      ) : (
        <>
          <AuthHeading
            title="Verify your number"
            subtitle={`Enter the OTP sent to ${maskIndianMobile(sentTo.current ?? "")}`}
          />
          <form onSubmit={onSubmitCode} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="otp-code">One-time code</Label>
              <Input
                id="otp-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                placeholder="••••••"
                className="h-12 text-center text-xl font-semibold tracking-[0.5em] tabular"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                aria-invalid={error ? true : undefined}
                autoFocus
              />
            </div>

            {error ? (
              <p className="text-sm leading-relaxed text-destructive" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              variant="brand"
              size="lg"
              block
              disabled={busy || code.length !== 6 || !confirmation.current}
            >
              {verifying || pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ShieldCheck className="size-4" aria-hidden />
              )}
              {verifying || pending
                ? "Verifying…"
                : mode === "link"
                  ? "Verify number"
                  : "Verify & Sign In"}
            </Button>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={changeNumber} disabled={busy}>
                <ArrowLeft className="size-4" aria-hidden />
                Change number
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || cooldown > 0 || !sentTo.current}
                onClick={() => sentTo.current && void sendCode(sentTo.current)}
              >
                {cooldown > 0 ? `Resend OTP in ${cooldown}s` : "Resend OTP"}
              </Button>
            </div>
          </form>
        </>
      )}

      {/* Firebase renders the invisible reCAPTCHA here. Must stay mounted
          across both stages, because resend reuses it. */}
      <div id={RECAPTCHA_CONTAINER_ID} />
    </div>
  );
}
