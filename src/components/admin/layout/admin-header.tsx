"use client";

import { useState, useTransition } from "react";
import { LogOut, Menu, ShieldCheck, UserCog } from "lucide-react";

import {
  AdminBrand,
  AdminDrawerNav,
} from "@/components/admin/layout/admin-sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAdminSession } from "@/lib/admin-store";
import { signOutOperator } from "@/app/admin/login/actions";
import { PERMISSION_LEVEL_LABELS } from "@/lib/admin-permissions";
import { cn } from "@/lib/utils";
import { initials } from "@/utils/format";

/**
 * The signed-in operator.
 *
 * This was a dropdown that let anyone "view as" any operator, because there was
 * no sign-in and the permission model needed *some* way to be exercised. It was
 * also the CRM's authorization hole: whatever it was set to travelled with
 * every mutation as the claimed identity.
 *
 * The identity now comes from a verified Supabase session resolved server-side
 * through `admin_agents.auth_user_id`, so there is nothing to switch — the
 * avatar, name and role remain, as the integration note always said they would.
 * Exercising the permission model means signing in as that operator.
 */
function OperatorBadge() {
  const session = useAdminSession();
  const [pending, startTransition] = useTransition();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 items-center gap-2.5 rounded-full py-1 pl-1 pr-2.5 text-left transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
            {initials(session.name)}
          </span>
          <span className="hidden min-w-0 sm:block">
            <span className="block truncate text-sm font-medium leading-tight">
              {session.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {session.role === "master_admin" ? "Master admin" : "Agent"}
            </span>
          </span>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Signed in</DropdownMenuLabel>
        <div className="px-2.5 pb-2">
          <p className="truncate text-sm font-medium">{session.name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.email}</p>
          <Badge variant="outline" className="mt-2">
            {session.role === "master_admin" ? "Master admin" : "Agent"}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <p className="px-2.5 py-2 text-xs leading-relaxed text-muted-foreground">
          Every action you take here is recorded in the audit log against this
          operator.
        </p>
        <DropdownMenuSeparator />
        <div className="p-1">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            disabled={pending}
            onClick={() => startTransition(async () => { await signOutOperator(); })}
          >
            <LogOut className="size-4" aria-hidden />
            {pending ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Mobile navigation drawer, opened from the header's menu button. */
function AdminNavDrawer() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label="Open navigation"
        onClick={() => setOpen(true)}
      >
        <Menu className="size-5" />
      </Button>

      <SheetContent side="left" className="px-0 py-4">
        <SheetHeader className="px-3 pb-4 pt-0">
          <SheetTitle className="sr-only">Admin navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Jump to a section of the Master CRM.
          </SheetDescription>
          <AdminBrand onNavigate={() => setOpen(false)} />
        </SheetHeader>
        <AdminDrawerNav onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}

interface AdminHeaderProps {
  title: string;
  description?: string;
  /** Controls rendered on the right of the title row. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Sticky CRM header: navigation trigger, page title, operator switcher.
 *
 * The role badge is always visible so an operator can see at a glance what
 * they are allowed to do before they try to do it.
 */
export function AdminHeader({
  title,
  description,
  actions,
  className,
}: AdminHeaderProps) {
  const session = useAdminSession();
  const isMaster = session.role === "master_admin";

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur-md",
        className,
      )}
    >
      <div className="pt-safe" />
      <div className="flex items-center gap-2 px-3 py-2.5 sm:px-5 lg:px-8">
        <AdminNavDrawer />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              {title}
            </h1>
            <Badge variant={isMaster ? "brand" : "outline"} className="shrink-0">
              {isMaster ? (
                <ShieldCheck className="size-3" aria-hidden />
              ) : (
                <UserCog className="size-3" aria-hidden />
              )}
              {isMaster ? "Master admin" : "Agent"}
            </Badge>
          </div>
          {description ? (
            <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="hidden shrink-0 items-center gap-2 md:flex">
            {actions}
          </div>
        ) : null}

        <OperatorBadge />
      </div>

      {/* Below `md` the header actions move under the title so they never
          squeeze the operator badge off-screen. */}
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 px-3 pb-3 sm:px-5 md:hidden">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

/** Read-only summary of what the current operator may do in an area. */
export function PermissionHint({
  level,
  className,
}: {
  level: "none" | "view" | "manage";
  className?: string;
}) {
  if (level === "manage") return null;
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {PERMISSION_LEVEL_LABELS[level]} — actions in this section are unavailable
      to your role.
    </p>
  );
}
