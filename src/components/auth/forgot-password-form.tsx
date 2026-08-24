"use client";

import { useState } from "react";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import { toast } from "sonner";

import {
  AuthFooterLink,
  AuthHeading,
  AuthUnconfigured,
  EMAIL_PATTERN,
} from "@/components/auth/auth-shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { siteUrl } from "@/lib/site-url";

/**
 * Password recovery, step one.
 *
 * Supabase issues and validates the recovery token. This application has no
 * reset-token table, no expiry logic and no way to mint one — which is the
 * point: a second password-reset mechanism is a second way to take over an
 * account, and the correct number of them is one.
 *
 * The confirmation below is shown whether or not the address is registered.
 * Saying "no account with that email" would let anyone enumerate the user list
 * one address at a time.
 */
export function ForgotPasswordForm({ configured }: { configured: boolean }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  if (!configured) return <AuthUnconfigured />;

  const emailValid = EMAIL_PATTERN.test(email.trim());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!emailValid || busy) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.resetPasswordForEmail(
        email.trim().toLowerCase(),
        {
          // `type=recovery` arrives here; the callback sends it on to
          // /reset-password rather than treating it as an ordinary sign-in.
          redirectTo: siteUrl("/auth/callback?next=/update-password"),
        },
      );
      if (error) throw error;
      setSent(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not send the reset email.",
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
          <h1 className="text-lg font-semibold tracking-tight">Check your email</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            If an account exists for{" "}
            <span className="font-medium text-foreground">{email.trim()}</span>,
            a password reset link is on its way.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The link expires shortly and can be used once.
          </p>
        </Card>
        <AuthFooterLink prompt="Remembered it?" href="/login" label="Back to sign in" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Reset your password"
        subtitle="We will email you a link to choose a new one."
      />

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="reset-email">Email address</Label>
          <Input
            id="reset-email"
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
        <Button
          type="submit"
          variant="brand"
          size="lg"
          className="w-full"
          disabled={!emailValid || busy}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <KeyRound className="size-4" aria-hidden />
          )}
          {busy ? "Sending…" : "Send reset link"}
        </Button>
      </form>

      <AuthFooterLink prompt="Remembered it?" href="/login" label="Back to sign in" />
    </div>
  );
}
