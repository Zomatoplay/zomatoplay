"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { toast } from "sonner";

import {
  AuthFooterLink,
  AuthHeading,
  describePasswordProblem,
  isPasswordAcceptable,
  PASSWORD_MIN_LENGTH,
} from "@/components/auth/auth-shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

/**
 * Password recovery, step two.
 *
 * Reached only with a recovery session, which `/auth/callback` established from
 * the emailed link. That session is the authorization: `updateUser` changes the
 * password of whoever the session belongs to, and there is no field on this
 * form naming an account. A page that took an email address here would let
 * anyone reset anyone's password.
 */
export function ResetPasswordForm({ hasSession }: { hasSession: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(hasSession);

  /**
   * A recovery link can also arrive as a URL fragment (`#access_token=…`),
   * which the server never sees. `supabase-js` consumes it on load and emits
   * `PASSWORD_RECOVERY`, so the page waits a beat for that before concluding
   * there is no session.
   */
  useEffect(() => {
    if (hasSession) return;
    const supabase = getSupabaseBrowserClient();
    const { data } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) {
          setReady(true);
        }
      },
    );
    void supabase.auth.getSession().then((result) => {
      if (result.data.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, [hasSession]);

  const problem = describePasswordProblem(password, confirmation);
  const canSubmit =
    ready && isPasswordAcceptable(password) && confirmation === password && !busy;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated", {
        description: "Sign in with your new password.",
      });
      // Ends the recovery session deliberately: it was issued to change a
      // password, and signing in again proves the new one works.
      await supabase.auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update the password.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="space-y-6">
        <Card className="space-y-3 p-6 text-center">
          <h1 className="text-lg font-semibold tracking-tight">
            This reset link is not valid
          </h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            It has expired, has already been used, or was opened in a different
            browser from the one that requested it. Request a new one.
          </p>
        </Card>
        <AuthFooterLink
          prompt="Need another link?"
          href="/forgot-password"
          label="Request a reset"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Choose a new password"
        subtitle="You will be signed out and asked to sign in with it."
      />

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="new-password-help"
            required
          />
          <p
            id="new-password-help"
            className={cn(
              "text-xs leading-relaxed",
              problem ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {problem ??
              `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-new-password">Repeat new password</Label>
          <Input
            id="confirm-new-password"
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
            <ShieldCheck className="size-4" aria-hidden />
          )}
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
    </div>
  );
}
