"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MailCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import {
  AuthFooterLink,
  AuthHeading,
  AuthUnconfigured,
  describePasswordProblem,
  EMAIL_PATTERN,
  isPasswordAcceptable,
  PASSWORD_MIN_LENGTH,
} from "@/components/auth/auth-shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { siteUrl } from "@/lib/site-url";
import { cn } from "@/lib/utils";

import { completeSignIn } from "@/app/(auth)/login/actions";

/**
 * Registration.
 *
 * WHERE THE PASSWORD GOES
 * -----------------------
 * To Supabase, over TLS, and nowhere else. It is never sent to a server action,
 * never written to `public.users`, never logged, and there is no column in this
 * application's schema that could hold it. `supabase.auth.signUp` is the only
 * function in this file that sees it.
 *
 * The name is passed as `options.data.full_name`, which Supabase stores on the
 * auth user's metadata. The server reads it back when it creates the
 * application account, so a registered user never has to retype it.
 *
 * TWO OUTCOMES, BOTH NORMAL
 * -------------------------
 * With email confirmation on (the default, and what production should use)
 * `signUp` returns no session and the person must click the link in their
 * inbox. With it off — a common local-development setting — a session comes
 * back immediately and the account is resolved right away. Both are handled;
 * the difference is a Supabase project setting, not something to encode here.
 */
export function SignUpForm({
  configured,
  next,
}: {
  configured: boolean;
  next: string;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (!configured) return <AuthUnconfigured />;

  const nameValid = fullName.trim().length >= 2;
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const passwordProblem = describePasswordProblem(password, confirmation);
  const canSubmit =
    nameValid &&
    emailValid &&
    isPasswordAcceptable(password) &&
    confirmation === password &&
    !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          // Where the confirmation link lands. Without this Supabase uses the
          // project's Site URL, which has no route able to exchange the code —
          // the cause of the sign-up loop this flow replaced.
          emailRedirectTo: siteUrl(`/auth/callback?next=${encodeURIComponent(next)}`),
        },
      });
      if (error) throw error;

      if (data.session) {
        // Confirmation is off in this project: already signed in.
        const result = await completeSignIn({ next });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        router.replace(result.redirectTo);
        router.refresh();
        return;
      }

      setSent(true);
    } catch (error) {
      // Supabase does not distinguish "already registered" from a fresh
      // sign-up in its default configuration — that is deliberate on their
      // side, and turning it into a specific message here would rebuild the
      // account-existence oracle it exists to prevent.
      toast.error(
        error instanceof Error ? error.message : "Could not create the account.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-6">
        <Card className="space-y-3 p-6 text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft text-brand">
            <MailCheck className="size-7" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">Confirm your email</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            We sent a confirmation link to{" "}
            <span className="font-medium text-foreground">{email.trim()}</span>.
            Open it on this device to finish creating your account.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The link can only be used once. If it has expired, request a new one
            by signing up again with the same address.
          </p>
        </Card>
        <AuthFooterLink
          prompt="Already confirmed?"
          href="/login"
          label="Go to sign in"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Create your account"
        subtitle="You will confirm your email before you can sign in."
      />

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="signup-name">Full name</Label>
          <Input
            id="signup-name"
            autoComplete="name"
            autoFocus
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="As it appears on your ID"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-email">Email address</Label>
          <Input
            id="signup-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-password">Password</Label>
          <Input
            id="signup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="signup-password-help"
            required
          />
          <p
            id="signup-password-help"
            className={cn(
              "text-xs leading-relaxed",
              passwordProblem ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {passwordProblem ??
              `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-confirm">Repeat password</Label>
          <Input
            id="signup-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            aria-invalid={confirmation.length > 0 && confirmation !== password}
            required
          />
        </div>

        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="w-full"
          disabled={!canSubmit}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <UserPlus className="size-4" aria-hidden />
          )}
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <AuthFooterLink
        prompt="Already have an account?"
        href="/login"
        label="Log in"
      />
    </div>
  );
}
