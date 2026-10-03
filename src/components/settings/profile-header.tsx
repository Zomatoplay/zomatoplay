"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { genderLabel } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { usePrototypeStore } from "@/lib/prototype-store";
import { initials } from "@/utils/format";

/**
 * Profile summary at the top of Settings. Reads the account from the store, so
 * the badge stays in step with the verification flow and the name and email
 * are the ones the server read.
 */
export function ProfileHeader() {
  const { profile, kycStatus } = usePrototypeStore();

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <Avatar className="size-14 shrink-0">
          {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt="" /> : null}
          <AvatarFallback className="text-base">
            {initials(profile.fullName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">
            {profile.fullName}
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {/* A phone-only account has no email; show its number instead. */}
            {profile.email || profile.phone}
          </p>
          {genderLabel(profile.gender) ? (
            <p className="truncate text-xs text-muted-foreground">
              {genderLabel(profile.gender)}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge kind="kyc" status={kycStatus} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">User ID</p>
          <p className="tabular truncate font-mono text-sm text-foreground">
            {profile.displayId}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CopyButton
            value={profile.displayId}
            label="user ID"
            successMessage="User ID copied"
          />
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/profile">
              <Pencil className="size-3.5" />
              Edit
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
