"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { ADMIN_APP_NAME, ADMIN_APP_SUBTITLE } from "@/constants/admin";
import {
  ADMIN_NAV,
  ADMIN_NAV_GROUPS,
  isAdminNavItemActive,
} from "@/constants/admin-navigation";
import { canView } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { cn } from "@/lib/utils";

/**
 * Admin navigation list, shared by the fixed desktop sidebar and the mobile
 * drawer. Destinations the current operator cannot view are omitted entirely —
 * a nav item that always 403s is worse than no nav item.
 */
export function AdminNavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { session } = useAdminStore();

  const visible = ADMIN_NAV.filter((item) => canView(session, item.permission));

  return (
    <nav aria-label="Admin sections" className="space-y-6">
      {ADMIN_NAV_GROUPS.map((group) => {
        const items = visible.filter((item) => item.group === group);
        if (items.length === 0) return null;

        return (
          <div key={group}>
            <h2 className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group}
            </h2>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = isAdminNavItemActive(item, pathname);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        active
                          ? "bg-brand-soft text-brand"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="min-w-0">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Brand lockup at the top of both navigation surfaces. */
export function AdminBrand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/admin"
      onClick={onNavigate}
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">
        N
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold leading-tight">
          {ADMIN_APP_NAME}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {ADMIN_APP_SUBTITLE}
        </span>
      </span>
    </Link>
  );
}

/** Footer shared by both navigation surfaces. */
function AdminNavFooter() {
  return (
    <div className="mt-auto space-y-3 pt-6">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
        Open the user app
      </Link>
      <p className="px-3 text-[11px] leading-relaxed text-muted-foreground">
        Demo build. Sample data only — no real accounts, funds or documents.
      </p>
    </div>
  );
}

/**
 * Fixed desktop sidebar. Hidden below `lg`, where `AdminNavDrawer` in the
 * header takes over.
 */
export function AdminSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card px-3 py-5 lg:flex">
      <div className="mb-7">
        <AdminBrand />
      </div>
      <AdminNavList />
      <AdminNavFooter />
    </aside>
  );
}

/** Contents of the mobile drawer — the same list in a scrollable column. */
export function AdminDrawerNav({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-6">
      <AdminNavList onNavigate={onNavigate} />
      <AdminNavFooter />
    </div>
  );
}
