"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { PrototypeNote } from "@/components/shared/notices";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePrototypeStore } from "@/lib/prototype-store";
import { updateProfileAction } from "@/app/(app)/settings/account-actions";
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
export function ProfileForm() {
  const { profile } = usePrototypeStore();
  const router = useRouter();
  const [fullName, setFullName] = useState(profile.fullName);
  const [phone, setPhone] = useState(profile.phone);
  const [saving, startTransition] = useTransition();

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
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <Avatar className="size-20">
            <AvatarFallback className="text-xl">
              {initials(fullName || profile.fullName)}
            </AvatarFallback>
          </Avatar>
          <button
            type="button"
            onClick={() =>
              toast("Photo upload is not part of this build", {
                description: "The control is here to show where it will live.",
              })
            }
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Camera className="size-3.5" aria-hidden />
          </button>
        </div>
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
            Your email is your sign-in and cannot be changed here.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-phone">Phone</Label>
          <Input
            id="profile-phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
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

      <PrototypeNote />

      <Button type="submit" variant="brand" size="lg" block disabled={saving}>
        {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
