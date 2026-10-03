"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Mail, UserRound, X } from "lucide-react";
import { toast } from "sonner";

import {
  requestAvatarUploadAction,
  saveProfile,
} from "@/app/(auth)/complete-profile/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_NAME } from "@/constants/app";
import { prepareKycImage } from "@/lib/image-compress";
import { GENDERS, isValidEmail, type Gender } from "@/lib/profile";
import { cn } from "@/lib/utils";

const AVATAR_ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * First-time profile setup, shown after the first OTP sign-in (and to any
 * existing account still missing a required field). Name, gender and email are
 * required; the photo is optional and goes to private S3 only if chosen.
 *
 * Fields the account already has are filled in and kept, so a returning
 * customer missing only (say) gender is asked only to confirm the rest. Every
 * rule here runs again in `saveProfile`.
 */
export function CompleteProfileForm({
  signedInAs,
  initialFullName,
  initialGender,
  initialEmail,
  phoneVerified,
  avatarUploadAvailable,
  initialAvatarUrl,
}: {
  signedInAs: string;
  initialFullName: string;
  initialGender: string | null;
  initialEmail: string;
  phoneVerified: boolean;
  avatarUploadAvailable: boolean;
  initialAvatarUrl: string | null;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialFullName);
  const [gender, setGender] = useState<Gender | "">(
    (GENDERS.find((g) => g.id === initialGender)?.id ?? "") as Gender | "",
  );
  const [email, setEmail] = useState(initialEmail);
  const [phone, setPhone] = useState("");
  const [touched, setTouched] = useState(false);
  const [avatarKey, setAvatarKey] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(initialAvatarUrl);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  // Object URLs are released when replaced or on unmount.
  useEffect(() => {
    return () => {
      if (avatarPreview?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview);
    };
  }, [avatarPreview]);

  const nameOk = fullName.trim().length >= 2;
  const emailOk = isValidEmail(email);
  const genderOk = gender !== "";
  const phoneOk = phoneVerified || phone.replace(/\D/g, "").length >= 8;
  const valid = nameOk && emailOk && genderOk && phoneOk && !uploading;

  async function choosePhoto(file: File) {
    setUploading(true);
    try {
      const prepared = await prepareKycImage(file, file.name, "selfie");
      const target = await requestAvatarUploadAction({
        contentType: prepared.contentType,
        byteSize: prepared.blob.size,
      });
      if (!target.ok) {
        toast.error(target.message);
        return;
      }
      const response = await fetch(target.url, {
        method: "PUT",
        headers: target.headers,
        body: prepared.blob,
      });
      if (!response.ok) {
        toast.error("The photo could not be uploaded. You can continue without it.");
        return;
      }
      setAvatarKey(target.key);
      setAvatarPreview(URL.createObjectURL(prepared.blob));
    } catch {
      toast.error("The photo could not be uploaded. You can continue without it.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    startTransition(async () => {
      const result = await saveProfile({
        fullName,
        gender,
        email,
        avatarKey,
        phone: phoneVerified ? undefined : phone,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Welcome to ${APP_NAME}`);
      router.replace("/");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={!avatarUploadAvailable || uploading || pending}
            aria-label={avatarPreview ? "Change profile photo" : "Add a profile photo"}
            className={cn(
              "group relative flex size-28 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-border bg-secondary/60 transition-colors",
              avatarUploadAvailable && "hover:border-brand focus-visible:border-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              avatarPreview && "border-solid border-brand/40",
            )}
          >
            {avatarPreview ? (
              // eslint-disable-next-line @next/next/no-img-element -- a blob: preview or a short-lived presigned URL; next/image cannot optimise either.
              <img src={avatarPreview} alt="" className="size-full object-cover" />
            ) : (
              <UserRound className="size-12 text-muted-foreground" aria-hidden />
            )}
            {uploading ? (
              <span className="absolute inset-0 flex items-center justify-center bg-background/70">
                <Loader2 className="size-6 animate-spin text-brand" aria-hidden />
              </span>
            ) : null}
          </button>
          {avatarUploadAvailable ? (
            <span
              className="pointer-events-none absolute bottom-0.5 right-0.5 flex size-9 items-center justify-center rounded-full border-2 border-background bg-brand text-brand-foreground shadow-sm"
              aria-hidden
            >
              <Camera className="size-4" />
            </span>
          ) : null}
          {avatarKey ? (
            <button
              type="button"
              onClick={() => {
                setAvatarKey(null);
                setAvatarPreview(initialAvatarUrl);
              }}
              className="absolute -right-1 -top-1 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
              aria-label="Remove the new photo"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          ) : null}
          <input
            ref={fileInput}
            type="file"
            accept={AVATAR_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void choosePhoto(file);
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {avatarUploadAvailable
            ? "Profile photo · optional"
            : "Profile photo upload isn't available right now — you can continue without one."}
        </p>

        <div className="space-y-1.5 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Set up your profile</h1>
          <p className="text-sm text-muted-foreground">
            Welcome to {APP_NAME}. Signed in as {signedInAs}.
          </p>
        </div>
      </div>

      <div className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            autoComplete="name"
            autoFocus={initialFullName.length === 0}
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="As it appears on your ID"
            aria-invalid={touched && !nameOk ? true : undefined}
            maxLength={120}
            required
          />
          {touched && !nameOk ? (
            <p className="text-xs text-destructive">Enter your full name.</p>
          ) : null}
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Gender</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Gender">
            {GENDERS.map((option) => {
              const selected = gender === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setGender(option.id)}
                  className={cn(
                    "min-h-11 rounded-xl border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-brand bg-brand-soft text-foreground"
                      : "border-border text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          {touched && !genderOk ? (
            <p className="text-xs text-destructive">Choose one option.</p>
          ) : null}
        </fieldset>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            aria-invalid={touched && !emailOk ? true : undefined}
            aria-describedby="email-help"
            required
          />
          {touched && !emailOk ? (
            <p className="text-xs text-destructive">Enter a valid email address.</p>
          ) : null}
          <p
            id="email-help"
            className="flex items-start gap-2 rounded-xl bg-secondary/60 p-3 text-xs leading-relaxed text-muted-foreground"
          >
            <Mail className="mt-0.5 size-3.5 shrink-0 text-brand" aria-hidden />
            <span>
              This is your account&rsquo;s contact address for important
              communications, such as deposit and withdrawal confirmations and
              account notices. Today these confirmations appear in the app; email
              delivery will use this address when it&rsquo;s switched on. Use an
              address you check.
            </span>
          </p>
        </div>

        {phoneVerified ? null : (
          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+91 90000 00000"
              required
            />
          </div>
        )}
      </div>

      <Button type="submit" variant="brand" size="lg" className="w-full" disabled={pending || uploading}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}
