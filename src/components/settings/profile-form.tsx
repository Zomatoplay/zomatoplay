"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { genderLabel } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrototypeStore } from "@/lib/prototype-store";
import { updateProfileAction } from "@/app/(app)/settings/account-actions";
import { saveAvatarAction } from "@/app/(auth)/complete-profile/actions";
import { AVATAR_ACCEPT, uploadAvatarFile } from "@/components/settings/avatar-upload";
import { formatDate, initials } from "@/utils/format";

/**
 * Editable profile fields.
 *
 * Name and phone are written to `public.users`. The email address is read-only
 * and that is deliberate: Supabase Auth owns it. It is the sign-in identifier
 * and the address a verification link proved control of, so changing it here
 * would leave the two authorities disagreeing — sign in with one address, see
 * another — and would let an account be re-pointed at an unverified mailbox.
 * A real email change goes through Supabase's own re-verification, which is a
 * separate flow that has not been built.
 *
 * This form used to `setTimeout(500)` and then claim success while persisting
 * nothing.
 */
export function ProfileForm({ avatarUploadAvailable }: { avatarUploadAvailable: boolean }) {
  const { profile } = usePrototypeStore();
  const router = useRouter();
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone);
  const [saving, startTransition] = useTransition();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Uploads to private S3, then the server checks the object and saves the key. */
  async function changePhoto(file: File) {
    setPhotoBusy(true);
    try {
      const uploaded = await uploadAvatarFile(file);
      if (!uploaded.ok) {
        toast.error(uploaded.message);
        return;
      }
      const saved = await saveAvatarAction({ avatarKey: uploaded.key });
      if (!saved.ok) {
        URL.revokeObjectURL(uploaded.previewUrl);
        toast.error(saved.message);
        return;
      }
      setPreview(uploaded.previewUrl);
      toast.success(saved.message);
      router.refresh();
    } catch {
      toast.error("The photo could not be saved. Try again.");
    } finally {
      setPhotoBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateProfileAction({ fullName, phone });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success("Profile updated");
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-col items-center gap-2">
        <div className="relative">
          <Avatar className="size-20">
            {preview || profile.avatarUrl ? (
              <AvatarImage src={preview ?? profile.avatarUrl ?? undefined} alt="" />
            ) : null}
            <AvatarFallback className="text-xl">
              {initials(fullName || profile.fullName)}
            </AvatarFallback>
          </Avatar>
          {photoBusy ? (
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70">
              <Loader2 className="size-5 animate-spin text-brand" aria-hidden />
            </span>
          ) : null}
          {avatarUploadAvailable ? (
            <>
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={photoBusy}
                className="absolute -bottom-1 -right-1 flex size-9 items-center justify-center rounded-full border-2 border-background bg-brand text-brand-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={profile.avatarUrl || preview ? "Change profile photo" : "Add a profile photo"}
              >
                <Camera className="size-4" aria-hidden />
              </button>
              <input
                ref={fileInput}
                type="file"
                accept={AVATAR_ACCEPT}
                className="sr-only"
                tabIndex={-1}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void changePhoto(file);
                }}
              />
            </>
          ) : null}
        </div>
        {avatarUploadAvailable ? (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={photoBusy}
            className="text-sm font-medium text-brand hover:underline"
          >
            {profile.avatarUrl || preview ? "Change photo" : "Add photo"}
          </button>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Member since {formatDate(profile.memberSince)}
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Full name</Label>
          <Input
            id="profile-name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Must match your verification document.
          </p>
        </div>

        {profile.email ? (
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <div className="relative">
              <Input
                id="profile-email"
                type="email"
                value={profile.email}
                readOnly
                disabled
                className="pr-11"
              />
              <Lock
                className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {profile.phoneVerified
                ? "Your registered contact email. Contact support to change it."
                : "Your email is your sign-in and cannot be changed here."}
            </p>
          </div>
        ) : null}

        {genderLabel(profile.gender) ? (
          <div className="space-y-1.5">
            <Label htmlFor="profile-gender">Gender</Label>
            <Input id="profile-gender" value={genderLabel(profile.gender) ?? ""} readOnly disabled />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <Label htmlFor="profile-phone">{profile.phoneVerified ? "Mobile number" : "Phone"}</Label>
          {profile.phoneVerified ? (
            <>
              <div className="relative">
                <Input
                  id="profile-phone"
                  type="tel"
                  value={profile.phone}
                  readOnly
                  disabled
                  className="pr-11 tabular"
                />
                <Lock
                  className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Verified by OTP — this is how you sign in. Contact support to change it.
              </p>
            </>
          ) : (
            <Input
              id="profile-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-id">User ID</Label>
          <div className="relative">
            <Input
              id="profile-id"
              value={profile.displayId}
              readOnly
              disabled
              className="pr-11 font-mono"
            />
            <Lock
              className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Your user ID cannot be changed.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-country">Country</Label>
          <div className="relative">
            <Input
              id="profile-country"
              value={profile.country}
              readOnly
              disabled
              className="pr-11"
            />
            <Lock
              className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Contact support to change your registered country.
          </p>
        </div>
      </div>

      <Button type="submit" variant="brand" size="lg" block disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
