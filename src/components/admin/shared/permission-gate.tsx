"use client";

import Link from "next/link";
import { Lock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { canView } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import type { AdminPermissionId } from "@/types/admin";

/**
 * Hides a whole screen from an operator whose role does not include it.
 *
 * This is a **usability affordance, not a security boundary**. All of the data
 * is already in the client bundle in this prototype, and even with a real API
 * a client-side check proves nothing.
 *
 * INTEGRATION POINT: the same permission id must be enforced server-side on
 * every route handler and query. Treat this component as the UI half of a
 * check whose authoritative half lives on the server.
 */
export function PermissionGate({
  permission,
  children,
}: {
  permission: AdminPermissionId;
  children: React.ReactNode;
}) {
  const { session } = useAdminStore();

  if (canView(session, permission)) return <>{children}</>;

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground">
        <Lock className="size-5" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          You do not have access to this section
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your role does not include the{" "}
          <span className="font-medium text-foreground">{permission}</span>{" "}
          permission. A master admin can grant it from Agents.
        </p>
      </div>
      <Button asChild variant="outline" size="sm">
        <Link href="/admin">Back to dashboard</Link>
      </Button>
    </div>
  );
}

/**
 * Explains why a control is disabled, rather than silently removing it.
 *
 * Removing a button leaves the operator wondering whether the feature exists;
 * a disabled control with a reason tells them exactly who to ask.
 */
export function ManageHint({ permission }: { permission: AdminPermissionId }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
      You have view-only access to {permission.replace(/_/g, " ")}. Actions in
      this section are disabled for your role.
    </p>
  );
}
