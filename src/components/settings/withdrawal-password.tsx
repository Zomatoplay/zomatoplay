"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, KeyRound, Loader2, LockKeyhole, Mail, Send, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { usePhoneOtp } from "@/components/auth/use-phone-otp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_NAME } from "@/constants/app";
import { maskIndianMobile } from "@/lib/phone";
import { withdrawalPasswordRefusal } from "@/lib/withdrawal-password-rules";
import { createWithdrawalPasswordAction } from "@/app/(app)/settings/withdrawal-password-actions";

/**
 * Creating a withdrawal password: choose it (twice) → SMS code to the
 * account's verified number → saved.
 *
 * The code comes last on purpose: the server accepts an SMS verification for
 * five minutes, and asking for it after the password is chosen means a person
 * who takes their time over the password is not refused for it.
 *
 * Nothing here is trusted. The rules shown are the server's own
 * (`withdrawal-password-rules`), the code is verified by Firebase and then by
 * the server against this account's number, and the password is hashed
 * server-side.
 */
export function WithdrawalPasswordSetup({
  phoneE164,
  localTest = null,
  onDone,
}: {
  /** The account's own verified number — the only one a code can go to. */
  phoneE164: string;
  localTest?: { phoneE164: string } | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const otp = usePhoneOtp({ purpose: "withdrawal-password", localTest });
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [code, setCode] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  const refusal = withdrawalPasswordRefusal(password, confirm, phoneE164);
  const busy = otp.sending || otp.verifying || saving;
  const error = serverError ?? otp.error;

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setTouched(true);
    if (refusal || busy) return;
    setServerError(null);
    if (await otp.send(phoneE164)) setCode("");
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || refusal) return;
    setServerError(null);
    const proof = await otp.verify(code);
    if (!proof) return;

    setSaving(true);
    const result = await createWithdrawalPasswordAction({ proof, password, confirm }).catch(() => ({
      ok: false,
      message: "The request did not reach the server. Try again.",
    }));
    setSaving(false);

    if (!result.ok) {
      setServerError(result.message);
      otp.reset();
      setCode("");
      return;
    }
    setPassword("");
    setConfirm("");
    toast.success("Withdrawal password created", {
      description: "You will be asked for it each time you withdraw.",
    });
    onDone?.();
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      {!otp.sentTo ? (
        <form onSubmit={sendCode} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="wp-new">New withdrawal password</Label>
            <Input
              id="wp-new"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={touched && refusal ? true : undefined}
              aria-describedby="wp-rules"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wp-confirm">Confirm withdrawal password</Label>
            <Input
              id="wp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-invalid={touched && refusal ? true : undefined}
            />
          </div>
          <p id="wp-rules" className="text-xs leading-relaxed text-muted-foreground">
            At least 8 characters, with letters and numbers. This is separate
            from how you sign in — do not reuse a password from elsewhere.
          </p>
          {(touched && refusal) || error ? (
            <p className="text-sm leading-relaxed text-destructive" role="alert">
              {(touched && refusal) || error}
            </p>
          ) : null}
          <Button type="submit" variant="brand" size="lg" block disabled={busy}>
            {otp.sending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {otp.sending ? "Sending code…" : `Send code to ${maskIndianMobile(phoneE164)}`}
          </Button>
        </form>
      ) : (
        <form onSubmit={save} className="space-y-4" noValidate>
          <p className="text-sm leading-relaxed text-muted-foreground" role="status">
            Enter the code sent to {maskIndianMobile(otp.sentTo)} to confirm it is you.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="wp-code">One-time code</Label>
            <Input
              id="wp-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              className="h-12 text-center text-xl font-semibold tracking-[0.5em] tabular"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
          </div>
          {error ? (
            <p className="text-sm leading-relaxed text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" variant="brand" size="lg" block disabled={busy || code.length !== 6}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
            {busy ? "Saving…" : "Verify & create password"}
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
              Back
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy || otp.cooldown > 0}
              onClick={() => void otp.send(phoneE164)}
            >
              {otp.cooldown > 0 ? `Resend code in ${otp.cooldown}s` : "Resend code"}
            </Button>
          </div>
        </form>
      )}
      {/* Firebase renders the invisible reCAPTCHA here. */}
      <div ref={otp.recaptchaRef} />
    </div>
  );
}

/**
 * "Forgot withdrawal password?" — deliberately not a self-service reset.
 *
 * Whoever holds an unlocked phone could otherwise replace the password and
 * withdraw, so a reset is an operator decision (audited). This only tells the
 * person how to reach support.
 */
export function ForgotWithdrawalPassword({
  telegramUrl,
  supportEmail,
}: {
  telegramUrl: string | null;
  supportEmail: string | null;
}) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        className="min-h-11 text-sm font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => setOpen(true)}
      >
        Forgot withdrawal password?
      </button>
    );
  }
  return (
    <div className="space-y-3 rounded-xl border border-border bg-secondary/60 p-3.5" role="status">
      <p className="flex items-start gap-2 text-sm leading-relaxed text-foreground">
        <LockKeyhole className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        Please contact {APP_NAME} Support to reset your withdrawal password.
      </p>
      <div className="flex flex-wrap gap-2">
        {telegramUrl ? (
          <Button asChild variant="outline" size="sm">
            <a href={telegramUrl} target="_blank" rel="noopener noreferrer">
              <Send className="size-4" aria-hidden />
              Telegram support
            </a>
          </Button>
        ) : null}
        {supportEmail ? (
          <Button asChild variant="outline" size="sm">
            <a href={`mailto:${supportEmail}?subject=${encodeURIComponent("Withdrawal password reset")}`}>
              <Mail className="size-4" aria-hidden />
              {supportEmail}
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** The Security screen's section: status, setup, and the support route. */
export function WithdrawalPasswordSection({
  state,
  phoneE164,
  telegramUrl,
  supportEmail,
  localTest = null,
}: {
  state: { isSet: boolean; lockedUntil: string | null };
  phoneE164: string | null;
  telegramUrl: string | null;
  supportEmail: string | null;
  localTest?: { phoneE164: string } | null;
}) {
  const [settingUp, setSettingUp] = useState(false);

  return (
    <section id="withdrawal-password" className="scroll-mt-20 space-y-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Withdrawal password
      </h2>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
            <KeyRound className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {state.isSet ? "Withdrawal password is set" : "No withdrawal password yet"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {state.isSet
                ? state.lockedUntil
                  ? "Withdrawals are temporarily locked after too many incorrect attempts."
                  : "You enter it each time you request a withdrawal."
                : "You need one before you can withdraw. It is confirmed with a code sent to your mobile number."}
            </p>
          </div>
        </div>

        {state.isSet ? (
          <ForgotWithdrawalPassword telegramUrl={telegramUrl} supportEmail={supportEmail} />
        ) : !phoneE164 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Verify your mobile number first — the password is confirmed by SMS.
          </p>
        ) : settingUp ? (
          <WithdrawalPasswordSetup
            phoneE164={phoneE164}
            localTest={localTest}
            onDone={() => setSettingUp(false)}
          />
        ) : (
          <Button variant="brand" size="lg" block onClick={() => setSettingUp(true)}>
            Create withdrawal password
          </Button>
        )}
      </div>
    </section>
  );
}
