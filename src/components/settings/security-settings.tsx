"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, Monitor, ShieldCheck, Smartphone } from "lucide-react";
import { toast } from "sonner";

import { ListGroup, ListRow } from "@/components/shared/list-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { usePrototypeStore } from "@/lib/prototype-store";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  describePasswordProblem,
  isPasswordAcceptable,
  PASSWORD_MIN_LENGTH,
} from "@/components/auth/auth-shared";
import {
  recordPasswordChangeAction,
  setSecondFactorAction,
} from "@/app/(app)/settings/account-actions";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/format";
import type { SecurityActivity } from "@/types";

/**
 * Sign-in security: password, second-factor preferences, and account activity.
 *
 * WHERE THE PASSWORD GOES
 * -----------------------
 * To Supabase, from the browser, over TLS. It is not sent to a server action,
 * because this application has no column to put one in and no business seeing
 * one. What the server is told afterwards is that a change happened, so the
 * security feed and the CRM show the event.
 *
 * The current password is verified by re-authenticating with it before the
 * change. `updateUser` alone would let anyone who walked up to an unlocked
 * browser take the account over — Supabase does not require the old password,
 * so requiring it is this screen's job.
 *
 * The change-password sheet previously closed after 500ms and reported success
 * having done nothing at all.
 */
export function SecuritySettings({
  activity,
  signIn,
}: {
  /** Recent account events, read server-side. */
  activity: SecurityActivity[];
  /** How this session signed in, resolved server-side. */
  signIn: { method: "phone" | "email"; maskedPhone: string | null };
}) {
  const { profile, twoFactorEnabled, googleAuthEnabled } = usePrototypeStore();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  const [factors, applyFactor] = useOptimistic(
    { twoFactorEnabled, googleAuthEnabled },
    (
      state: { twoFactorEnabled: boolean; googleAuthEnabled: boolean },
      change: { factor: "twoFactor" | "googleAuth"; enabled: boolean },
    ) =>
      change.factor === "twoFactor"
        ? { ...state, twoFactorEnabled: change.enabled }
        : { ...state, googleAuthEnabled: change.enabled },
  );

  const passwordError = describePasswordProblem(next, confirm);

  const canSubmit =
    current.length > 0 && isPasswordAcceptable(next) && confirm === next && !saving;

  function setFactor(factor: "twoFactor" | "googleAuth", enabled: boolean) {
    startTransition(async () => {
      applyFactor({ factor, enabled });
      const result = await setSecondFactorAction({ factor, enabled });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        factor === "twoFactor"
          ? enabled
            ? "Two-factor authentication enabled"
            : "Two-factor authentication disabled"
          : enabled
            ? "Authenticator app linked"
            : "Authenticator app unlinked",
      );
      router.refresh();
    });
  }

  async function handlePasswordSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const supabase = getSupabaseBrowserClient();

      // Proves the person at the keyboard knows the current password. On
      // success this also refreshes the same session rather than starting a
      // second one.
      const { error: reauthError } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password: current,
      });
      if (reauthError) {
        toast.error("That is not your current password.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;

      await recordPasswordChangeAction();

      setPasswordOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password updated", {
        description: "Use it the next time you sign in.",
      });
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The password was not changed.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <ListGroup title="Sign-in">
        {signIn.method === "phone" ? (
          <ListRow
            as="div"
            icon={Smartphone}
            title="Mobile number"
            description={`${signIn.maskedPhone ?? "Your verified number"} — you sign in with a one-time code sent by SMS. There is no password.`}
          />
        ) : (
          <ListRow
            icon={KeyRound}
            title="Change password"
            description="Managed by your sign-in provider"
            onClick={() => setPasswordOpen(true)}
          />
        )}
      </ListGroup>

      <ListGroup title="Two-factor authentication">
        <ListRow
          icon={ShieldCheck}
          title="Two-factor authentication"
          description="Require a second step when signing in"
          hideChevron
          as="div"
          meta={
            <Switch
              checked={factors.twoFactorEnabled}
              onCheckedChange={(checked) => setFactor("twoFactor", checked)}
              aria-label="Two-factor authentication"
            />
          }
        />
        <ListRow
          icon={Smartphone}
          title="Google Authenticator"
          description="Use a TOTP code from your authenticator app"
          hideChevron
          as="div"
          meta={
            <Switch
              checked={factors.googleAuthEnabled}
              onCheckedChange={(checked) => setFactor("googleAuth", checked)}
              aria-label="Google Authenticator"
            />
          }
        />
      </ListGroup>

      <section id="activity" className="space-y-2 scroll-mt-20">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Login & security activity
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {activity.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 px-4 py-3.5">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  entry.status === "blocked"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-secondary text-foreground",
                )}
              >
                <Monitor className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{entry.event}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {entry.device} · {entry.location}
                </p>
                <p className="tabular mt-1 text-[11px] text-muted-foreground">
                  {formatDateTime(entry.date)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Sheet open={passwordOpen} onOpenChange={setPasswordOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Change password</SheetTitle>
            <SheetDescription>
              Choose a password you do not use anywhere else.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                aria-describedby="new-password-help"
              />
              <p
                id="new-password-help"
                className={cn(
                  "text-xs",
                  passwordError ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {passwordError ??
                  `At least ${PASSWORD_MIN_LENGTH} characters, with a letter and a number.`}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button
              variant="brand"
              size="lg"
              block
              disabled={!canSubmit}
              onClick={handlePasswordSubmit}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : null}
              {saving ? "Updating…" : "Update password"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
