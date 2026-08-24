"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, LogIn, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  AuthFooterLink,
  AuthHeading,
  AuthUnconfigured,
  EMAIL_PATTERN,
} from "@/components/auth/auth-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_NAME } from "@/constants/app";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import { completeSignIn } from "@/app/(auth)/login/actions";

/**
 * Sign-in: password first, one-time code as an alternative.
 *
 * WHAT THIS COMPONENT DOES NOT DO
 * -------------------------------
 * It does not hash, store, compare or validate a password, and it does not
 * generate or check a code. Supabase Auth does all of that. This form collects
 * credentials, hands them to Supabase, and — once Supabase has written a
 * session cookie — asks the server to resolve the application account.
 *
 * WHY BOTH METHODS
 * ----------------
 * The build was one-time-code only, which is a fine second factor and a poor
 * only door: every sign-in depended on email delivery, and a slow or filtered
 * message meant no way in at all. The password path is the default; the code
 * path stays for people who prefer it and as the way back in when a password is
 * forgotten mid-session.
 */
type Method = "password" | "code";

export function SignInForm({
  configured,
  next,
  initialError,
}: {
  configured: boolean;
  next: string;
  /** Surfaced by `/auth/callback` when an email link could not be used. */
  initialError?: string;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>("password");
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  // Reported once, on arrival. Kept out of the render path so a re-render
  // cannot re-fire it.
  useEffect(() => {
    if (initialError) toast.error(initialError);
  }, [initialError]);

  const emailValid = EMAIL_PATTERN.test(email.trim());
  const working = busy || pending;

  if (!configured) return <AuthUnconfigured />;

  /** Shared tail: Supabase has a session, the server resolves the account. */
  function finishSignIn() {
    startTransition(async () => {
      const result = await completeSignIn({ next });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.replace(result.redirectTo);
      router.refresh();
    });
  }

  async function signInWithPassword(event: React.FormEvent) {
    event.preventDefault();
    if (!emailValid || password.length === 0 || working) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;
      finishSignIn();
    } catch (error) {
      // Supabase answers a wrong password and an unknown email identically, on
      // purpose: distinguishing them turns the form into an account-existence
      // oracle. The message is passed through as-is.
      toast.error(
        error instanceof Error ? error.message : "Those details were not accepted.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    if (!emailValid || working) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        // No account is created from this path. Registration collects a name
        // and a password; letting a code silently create a nameless account
        // would produce two kinds of account with different data.
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setCodeSent(true);
      toast.success("Code sent", { description: `Check ${email.trim()}.` });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send the code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    if (code.trim().length < 6 || working) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: code.trim(),
        type: "email",
      });
      if (error) throw error;
      finishSignIn();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "That code was not accepted.",
      );
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* One-time code, step two                                             */
  /* ------------------------------------------------------------------ */
  if (method === "code" && codeSent) {
    return (
      <div className="space-y-6">
        <AuthHeading title="Enter your code" subtitle={`Sent to ${email.trim()}.`} />
        <form onSubmit={verifyCode} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="code">One-time code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 8))
              }
              placeholder="123456"
              className="tabular text-center text-lg tracking-[0.3em]"
              required
            />
          </div>
          <Button
            type="submit"
            variant="brand"
            size="lg"
            className="w-full"
            disabled={code.trim().length < 6 || working}
          >
            {working ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ShieldCheck className="size-4" aria-hidden />
            )}
            {working ? "Verifying…" : "Verify and continue"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setCodeSent(false);
              setCode("");
            }}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Back
          </Button>
        </form>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Sign in                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <div className="space-y-6">
      <AuthHeading
        title={APP_NAME}
        subtitle={
          method === "password"
            ? "Sign in to your account."
            : "We will email you a one-time code."
        }
      />

      <form
        onSubmit={method === "password" ? signInWithPassword : sendCode}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>

        {method === "password" ? (
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <Label htmlFor="password">Password</Label>
              <Link
                href="/forgot-password"
                className="text-xs font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
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
          disabled={
            working || !emailValid || (method === "password" && password.length === 0)
          }
        >
          {working ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : method === "password" ? (
            <LogIn className="size-4" aria-hidden />
          ) : (
            <Mail className="size-4" aria-hidden />
          )}
          {working
            ? method === "password"
              ? "Signing in…"
              : "Sending…"
            : method === "password"
              ? "Log in"
              : "Send code"}
        </Button>
      </form>

      <div className="space-y-3">
        <div className="flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">or</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => {
            setMethod(method === "password" ? "code" : "password");
            setPassword("");
            setCode("");
            setCodeSent(false);
          }}
        >
          {method === "password" ? (
            <>
              <Mail className="size-4" aria-hidden />
              Sign in with email code
            </>
          ) : (
            <>
              <LogIn className="size-4" aria-hidden />
              Sign in with password
            </>
          )}
        </Button>

        <Button asChild variant="ghost" size="lg" className="w-full">
          <Link href={`/signup?next=${encodeURIComponent(next)}`}>
            Create account
          </Link>
        </Button>
      </div>

      <AuthFooterLink
        prompt="Trouble signing in?"
        href="/forgot-password"
        label="Reset your password"
      />
    </div>
  );
}
