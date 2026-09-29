"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FlaskConical, KeyRound, Loader2, LogIn, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_APP_SUBTITLE } from "@/constants/admin";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import { completeOperatorSignIn } from "@/app/admin/login/actions";
import {
  completeLocalTestOperatorAction,
  startLocalTestOperatorAction,
} from "@/app/admin/login/dev-test-actions";

/**
 * Operator sign-in: work email → one-time code.
 *
 * WHO DECIDES WHAT
 * ----------------
 * Supabase proves control of the work mailbox (an emailed code, verified by
 * Supabase — never by this component). Whether that identity is an operator,
 * active, and allowed to do anything is `completeOperatorSignIn` →
 * `admin_agents`, server-side, unchanged. A phone-signed-in customer has no
 * Supabase identity at all, so there is nothing here they could present.
 *
 * `shouldCreateUser: false`: a code is only ever sent to an existing Supabase
 * user. The form says the same thing whether or not the address is known, so
 * it cannot be used to discover operator emails.
 *
 * The password form is kept as a secondary option until this deployment's
 * Supabase email delivery (SMTP) is confirmed — without it an OTP-only form
 * would lock every operator out. See the audit report.
 *
 * There is no "create an operator account" path, on purpose. Operators are
 * provisioned by a master admin; a self-service route into an operations
 * console is a way in for anyone who can receive email.
 */

type Step = "email" | "code" | "password";

const RESEND_COOLDOWN_S = 60;

export function AdminSignInForm({
  configured,
  reason,
  localTest = null,
}: {
  configured: boolean;
  /** Why the previous attempt was refused, if it was. */
  reason?: string;
  /** Development build on localhost with DEV_TEST_AUTH=true only. */
  localTest?: { email: string } | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** Set when the code step belongs to the local test path, not Supabase. */
  const [localChallenge, setLocalChallenge] = useState<string | null>(null);
  /**
   * A failure that is worth trying again, kept on screen rather than in a
   * toast that disappears while the operator is still reading it.
   */
  const [retryable, setRetryable] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const normalisedEmail = email.trim().toLowerCase();

  /** The credential is established; only the server may say whether it is an operator. */
  async function finish() {
    const result = await completeOperatorSignIn();
    if (!result.ok) {
      /*
       * THE SESSION IS ONLY DESTROYED ON AN ACTUAL VERDICT.
       *
       * This used to call `signOut()` for every `!ok`, including the case
       * where the server could not *reach* the database to find out. So a
       * pooler refusal cost the operator the session they had just paid a
       * full round trip for, and the next attempt started from nothing. That
       * is why signing in took five or six tries rather than a reload: each
       * failure was undoing the half that had worked.
       *
       * `retryable` is the server saying "no verdict was reached". The
       * session stays, the form offers another go, and nothing is granted —
       * the console's own gate resolves the operator again on every request
       * and refuses when it cannot.
       */
      if (result.retryable) {
        setRetryable(result.message);
        return;
      }

      // A real answer: a valid credential that belongs to no operator. The
      // session is ended rather than left lying around inside an operations
      // console.
      await getSupabaseBrowserClient().auth.signOut();
      toast.error(result.message);
      return;
    }

    router.replace("/admin");
    router.refresh();
  }

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || !normalisedEmail.includes("@")) return;
    setBusy(true);
    setRetryable(null);
    setNotice(null);
    try {
      if (localTest && normalisedEmail === localTest.email) {
        const started = await startLocalTestOperatorAction({ email: normalisedEmail });
        if (!started.ok || !started.challenge) {
          toast.error(started.message);
          return;
        }
        setLocalChallenge(started.challenge);
      } else {
        setLocalChallenge(null);
        const { error } = await getSupabaseBrowserClient().auth.signInWithOtp({
          email: normalisedEmail,
          options: { shouldCreateUser: false },
        });
        // An unknown address is refused by Supabase (no user is created) and
        // is shown exactly like a sent code, so the form reveals nothing.
        // A rate limit is worth saying; anything else is a real failure.
        if (error && error.status === 429) {
          toast.error("Too many codes requested. Wait a minute and try again.");
          return;
        }
        if (error && !isUnknownUserRefusal(error)) {
          toast.error("The code could not be sent. Try again, or use your password.");
          return;
        }
      }
      setNotice(
        "If this is an operator account, a sign-in code has been sent to it. Enter it below.",
      );
      setCode("");
      setStep("code");
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      toast.error("The code could not be sent. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !/^\d{6,10}$/.test(code)) return;
    setBusy(true);
    setRetryable(null);
    try {
      if (localChallenge) {
        const result = await completeLocalTestOperatorAction({
          email: normalisedEmail,
          code,
          challenge: localChallenge,
        });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
      } else {
        const { error } = await getSupabaseBrowserClient().auth.verifyOtp({
          email: normalisedEmail,
          token: code,
          type: "email",
        });
        if (error) {
          toast.error("Invalid or expired code.");
          return;
        }
      }
      await finish();
    } catch {
      toast.error("Unable to sign in. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !normalisedEmail || !password) return;
    setBusy(true);
    setRetryable(null);
    try {
      const { error } = await getSupabaseBrowserClient().auth.signInWithPassword({
        email: normalisedEmail,
        password,
      });
      if (error) throw error;
      await finish();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Those details were not accepted.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            {ADMIN_APP_SUBTITLE}
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Operator sign-in. Accounts are provisioned by a master admin.
          </p>
        </div>

        {localTest ? (
          <p className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/8 p-3 text-xs leading-relaxed text-foreground">
            <FlaskConical className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
            <span>
              Local test sign-in is on (development build, localhost). Test operator{" "}
              <span className="font-medium break-all">{localTest.email}</span>; its code is{" "}
              <code className="font-mono">DEV_TEST_ADMIN_OTP</code> in{" "}
              <code className="font-mono">.env.local</code>.
            </span>
          </p>
        ) : null}

        {reason ? (
          <Card className="border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm leading-relaxed text-destructive">{reason}</p>
          </Card>
        ) : null}

        {retryable ? (
          <Card className="space-y-2 border-warning/40 bg-warning/8 p-4">
            <p className="text-sm font-medium text-foreground">
              Your sign-in was accepted
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {retryable} Your session is still valid — press Continue.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setRetryable(null);
                try {
                  await finish();
                } finally {
                  setBusy(false);
                }
              }}
            >
              Continue
            </Button>
          </Card>
        ) : null}

        {!configured ? (
          <Card className="space-y-2 p-5 text-center">
            <p className="text-sm font-medium">Sign-in is not configured</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This deployment has no Supabase Auth configuration, so no operator
              can be authenticated — and the console does not open without one.
            </p>
          </Card>
        ) : step === "code" ? (
          <form onSubmit={verifyCode} className="space-y-4" noValidate>
            {notice ? (
              <p className="text-sm leading-relaxed text-muted-foreground" role="status">
                {notice}
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label htmlFor="operator-code">Sign-in code</Label>
              <Input
                id="operator-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                placeholder="••••••"
                className="h-12 text-center text-xl font-semibold tracking-[0.4em] tabular"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 10))}
                autoFocus
              />
            </div>
            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="w-full"
              disabled={busy || !/^\d{6,10}$/.test(code)}
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
                  setStep("email");
                  setLocalChallenge(null);
                  setCode("");
                }}
              >
                <ArrowLeft className="size-4" aria-hidden />
                Change email
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy || cooldown > 0}
                onClick={() => void sendCode()}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={step === "password" ? signInWithPassword : sendCode}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="operator-email">Work email</Label>
              <Input
                id="operator-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            {step === "password" ? (
              <div className="space-y-1.5">
                <Label htmlFor="operator-password">Password</Label>
                <Input
                  id="operator-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </div>
            ) : null}
            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="w-full"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : step === "password" ? (
                <LogIn className="size-4" aria-hidden />
              ) : (
                <Mail className="size-4" aria-hidden />
              )}
              {busy
                ? step === "password" ? "Signing in…" : "Sending code…"
                : step === "password" ? "Sign in" : "Email me a sign-in code"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={() => setStep(step === "password" ? "email" : "password")}
            >
              <KeyRound className="size-4" aria-hidden />
              {step === "password" ? "Use a one-time code instead" : "Use password instead"}
            </Button>
          </form>
        )}

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Every action taken here is recorded in the audit log against the
          operator who took it.
        </p>
      </div>
    </div>
  );
}

/**
 * Supabase's answer to "send a code to an address that has no account" when
 * sign-ups are off for OTP. Not an outage and not worth showing: saying so
 * would confirm which addresses are operators.
 */
function isUnknownUserRefusal(error: { status?: number; code?: string; message?: string }): boolean {
  return (
    error.code === "otp_disabled" ||
    error.code === "user_not_found" ||
    /signups? not allowed/i.test(error.message ?? "")
  );
}
