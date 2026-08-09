"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";

import { CopyButton } from "@/components/shared/copy-field";
import { StatusBadge } from "@/components/shared/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { currentUser } from "@/data/user";
import { usePrototypeStore } from "@/lib/prototype-store";
import { initials } from "@/utils/format";

/**
 * Profile summary at the top of Settings. Reads KYC status from the store so
 * the badge stays in step with the verification flow.
 */
export function ProfileHeader() {
  const { kycStatus } = usePrototypeStore();

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start gap-4">
        <Avatar className="size-14 shrink-0">
          <AvatarFallback className="text-base">
            {initials(currentUser.fullName)}
          </AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold tracking-tight">
            {currentUser.fullName}
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {currentUser.email}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge kind="kyc" status={kycStatus} />
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-muted-foreground">User ID</p>
          <p className="tabular truncate font-mono text-sm text-foreground">
            {currentUser.displayId}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CopyButton
            value={currentUser.displayId}
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
