"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FlaskConical, Loader2, LogIn, Smartphone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePhoneOtp } from "@/components/auth/use-phone-otp";
import { ADMIN_APP_NAME, ADMIN_APP_SUBTITLE } from "@/constants/admin";
import { maskIndianMobile, normalizeIndianMobile } from "@/lib/phone";

import { completeOperatorPhoneSignIn } from "@/app/admin/login/actions";

/**
 * Operator sign-in: mobile number → SMS code → operator session.
 *
 * WHO DECIDES WHAT
 * ----------------
 * Firebase proves control of the number (an SMS code, checked by Firebase —
 * never by this component). Whether that number belongs to an operator,
 * whether the operator is enabled, and what they may do are decided
 * server-side by `completeOperatorPhoneSignIn` → `admin_agents`, and every
 * console request is resolved and authorized again after that.
 *
 * There is no "create an operator account" path, on purpose. A master admin
 * provisions an operator's number; a self-service route into an operations
 * console is a way in for anyone with a phone.
 */
export function AdminSignInForm({
  configured,
  reason,
  localTest = null,
}: {
  configured: boolean;
  /** Why the previous attempt was refused, if it was. */
  reason?: string;
  /** Development build on localhost with DEV_TEST_AUTH=true only. */
  localTest?: { phoneE164: string } | null;
}) {
  const router = useRouter();
  const otp = usePhoneOtp({ purpose: "operator", localTest });
  const [phoneInput, setPhoneInput] = useState("");
  const [code, setCode] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [navigating, startTransition] = useTransition();

  const phoneE164 = normalizeIndianMobile(phoneInput);
  const busy = otp.sending || otp.verifying || submitting || navigating;
  const error = serverError ?? otp.error;

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setServerError(null);
    if (!phoneE164) {
      otp.setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (await otp.send(phoneE164)) setCode("");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setServerError(null);
    const proof = await otp.verify(code);
    if (!proof) return;

    setSubmitting(true);
    const result = await completeOperatorPhoneSignIn({ proof }).catch(() => ({
      ok: false,
      retryable: true,
      message: "The request did not reach the server. Try again.",
    }));
    setSubmitting(false);

    if (!result.ok) {
      setServerError(result.message);
      // The code has been spent either way; a retry needs a fresh one.
      otp.reset();
      setCode("");
      return;
    }
    startTransition(() => {
      router.replace("/admin");
      router.refresh();
    });
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <Image
            src="/logo.jpeg"
            alt={`${ADMIN_APP_NAME} logo`}
            width={72}
            height={72}
            priority
            sizes="72px"
            className="mx-auto size-[4.5rem] rounded-2xl"
          />
          <h1 className="text-xl font-semibold tracking-tight">{ADMIN_APP_NAME}</h1>
          <p className="text-sm font-medium text-muted-foreground">{ADMIN_APP_SUBTITLE}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Administrator sign-in with your registered mobile number. Access is
            provisioned by a master admin.
          </p>
        </div>

        {localTest ? (
          <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/8 p-3 text-xs leading-relaxed text-foreground">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              Local test sign-in is on (development build, localhost). Test operator number{" "}
              <span className="tabular font-medium">{localTest.phoneE164}</span>; its code is{" "}
              <code className="font-mono">DEV_TEST_ADMIN_OTP</code> in{" "}
              <code className="font-mono">.env.local</code>. Any other number uses real SMS.
            </span>
          </p>
        ) : null}

        {reason ? (
          <Card className="border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm leading-relaxed text-destructive">{reason}</p>
          </Card>
        ) : null}

        {!configured ? (
          <Card className="space-y-2 p-5 text-center">
            <p className="text-sm font-medium">Sign-in is not configured</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This deployment is missing the Firebase phone sign-in configuration
              or the operator session secret, so no operator can be
              authenticated — and the console does not open without one.
            </p>
          </Card>
        ) : !otp.sentTo ? (
          <form onSubmit={sendCode} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="operator-phone">Mobile number</Label>
              <div className="flex items-stretch gap-2">
                <span
                  className="flex h-11 shrink-0 items-center rounded-full border border-border bg-secondary px-3.5 text-base font-medium tabular"
                  aria-hidden
                >
                  +91
                </span>
                <Input
                  id="operator-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  maxLength={14}
                  className="h-11 text-base tabular"
                  value={phoneInput}
                  onChange={(event) => setPhoneInput(event.target.value)}
                  aria-invalid={error ? true : undefined}
                />
              </div>
            </div>
            {error ? (
              <p className="text-sm leading-relaxed text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy}>
              {otp.sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Smartphone className="size-4" aria-hidden />
              )}
              {otp.sending ? "Sending OTP…" : "Send OTP"}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyCode} className="space-y-4" noValidate>
            <p className="text-sm leading-relaxed text-muted-foreground" role="status">
              Enter the code sent to {maskIndianMobile(otp.sentTo)}.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="operator-code">One-time code</Label>
              <Input
                id="operator-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="••••••"
                className="h-12 text-center text-xl font-semibold tracking-[0.5em] tabular"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
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
              className="w-full"
              disabled={busy || code.length !== 6}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LogIn className="size-4" aria-hidden />}
              {busy ? "Verifying…" : "Verify & sign in"}
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  otp.reset();
                  setServerError(null);
                  setCode("");
                }}
              >
                <ArrowLeft className="size-4" aria-hidden />
                Change number
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || otp.cooldown > 0}
                onClick={() => otp.sentTo && void otp.send(otp.sentTo)}
              >
                {otp.cooldown > 0 ? `Resend OTP in ${otp.cooldown}s` : "Resend OTP"}
              </Button>
            </div>
          </form>
        )}

        {/* Firebase renders the invisible reCAPTCHA here. Stays mounted across
            both steps, because resend reuses it. */}
        <div ref={otp.recaptchaRef} />
      </div>
    </div>
  );
}
