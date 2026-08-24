"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_APP_SUBTITLE } from "@/constants/admin";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import { completeOperatorSignIn } from "@/app/admin/login/actions";

/**
 * Operator sign-in.
 *
 * Deliberately the same mechanism as the user application's: one credential
 * store, one place where a password lives, one set of session semantics to get
 * right. What differs is only what happens afterwards — the server looks the
 * principal up in `admin_agents` rather than `users`, and a session that
 * matches no operator row is refused here even though it is perfectly valid at
 * `/login`.
 *
 * There is no "create an operator account" path, on purpose. Operators are
 * provisioned by a master admin; a self-service route into an operations
 * console is a way in for anyone who can receive email.
 */
export function AdminSignInForm({
  configured,
  reason,
}: {
  configured: boolean;
  /** Why the previous attempt was refused, if it was. */
  reason?: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) throw error;

      // The credential is valid. Whether it belongs to an operator is a
      // separate question, and only the server may answer it.
      const result = await completeOperatorSignIn();
      if (!result.ok) {
        // Signed in as somebody, but not as an operator. The session is ended
        // rather than left lying around inside an operations console.
        await supabase.auth.signOut();
        toast.error(result.message);
        return;
      }

      router.replace("/admin");
      router.refresh();
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

        {reason ? (
          <Card className="border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm leading-relaxed text-destructive">{reason}</p>
          </Card>
        ) : null}

        {configured ? (
          <form onSubmit={submit} className="space-y-4">
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
            <Button
              type="submit"
              variant="brand"
              size="lg"
              className="w-full"
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <LogIn className="size-4" aria-hidden />
              )}
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <Card className="space-y-2 p-5 text-center">
            <p className="text-sm font-medium">Sign-in is not configured</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This deployment has no Supabase Auth configuration, so no operator
              can be authenticated — and the console does not open without one.
            </p>
          </Card>
        )}

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          Every action taken here is recorded in the audit log against the
          operator who took it.
        </p>
      </div>
    </div>
  );
}
