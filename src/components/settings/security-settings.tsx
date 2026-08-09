"use client";

import { useState } from "react";
import { KeyRound, Monitor, ShieldCheck, Smartphone } from "lucide-react";
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
import { securityActivity } from "@/data/user";
import { usePrototypeStore } from "@/lib/prototype-store";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/format";

export function SecuritySettings() {
  const { twoFactorEnabled, googleAuthEnabled, setTwoFactor, setGoogleAuth } =
    usePrototypeStore();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");

  const passwordError =
    next.length > 0 && next.length < 8
      ? "Use at least 8 characters."
      : confirm.length > 0 && confirm !== next
        ? "Passwords do not match."
        : null;

  const canSubmit =
    current.length > 0 && next.length >= 8 && confirm === next && !passwordError;

  function handlePasswordSubmit() {
    setPasswordOpen(false);
    setCurrent("");
    setNext("");
    setConfirm("");
    toast.success("Password updated", {
      description: "Demo build — no credentials are stored.",
    });
  }

  return (
    <div className="space-y-5">
      <ListGroup title="Sign-in">
        <ListRow
          icon={KeyRound}
          title="Change password"
          description="Last changed 02 Aug 2026"
          onClick={() => setPasswordOpen(true)}
        />
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
              checked={twoFactorEnabled}
              onCheckedChange={(checked) => {
                setTwoFactor(checked);
                toast.success(
                  checked
                    ? "Two-factor authentication enabled"
                    : "Two-factor authentication disabled",
                );
              }}
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
              checked={googleAuthEnabled}
              onCheckedChange={(checked) => {
                setGoogleAuth(checked);
                toast.success(
                  checked
                    ? "Authenticator app linked"
                    : "Authenticator app unlinked",
                );
              }}
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
          {securityActivity.map((entry) => (
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
                {passwordError ?? "At least 8 characters."}
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
              Update password
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
