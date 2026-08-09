"use client";

import { useState } from "react";
import { Camera, Lock } from "lucide-react";
import { toast } from "sonner";

import { PrototypeNote } from "@/components/shared/notices";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentUser } from "@/data/user";
import { formatDate, initials } from "@/utils/format";

/**
 * Editable profile fields. Name and country are locked once verification has
 * been submitted, as they must match the verified document.
 */
export function ProfileForm() {
  const [fullName, setFullName] = useState(currentUser.fullName);
  const [email, setEmail] = useState(currentUser.email);
  const [phone, setPhone] = useState(currentUser.phone);
  const [saving, setSaving] = useState(false);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    // Stands in for the profile mutation.
    setTimeout(() => {
      setSaving(false);
      toast.success("Profile updated", {
        description: "Demo build — changes are not persisted.",
      });
    }, 500);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <Avatar className="size-20">
            <AvatarFallback className="text-xl">
              {initials(fullName || currentUser.fullName)}
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
          Member since {formatDate(currentUser.memberSince)}
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
          <Input
            id="profile-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
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
              value={currentUser.displayId}
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
              value={currentUser.country}
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
        {saving ? "Saving…" : "Save changes"}
      </Button>
    </form>
  );
}
