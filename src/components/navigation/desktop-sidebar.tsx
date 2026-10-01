"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { APP_NAME, APP_TAGLINE } from "@/constants/app";
import { PRIMARY_NAV, isNavItemActive } from "@/constants/navigation";
import { cn } from "@/lib/utils";

/**
 * Desktop-only sidebar. It mirrors the same five sections as the mobile bar —
 * desktop is a wider frame around the same app, not a different information
 * architecture.
 */
export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 shrink-0 flex-col border-r border-border bg-card px-4 py-6 lg:flex">
      <Link
        href="/"
        className="mb-8 flex items-center gap-2.5 rounded-xl px-2 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand text-sm font-bold text-brand-foreground">
          N
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold leading-tight">
            {APP_NAME}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {APP_TAGLINE}
          </span>
        </span>
      </Link>

      <nav aria-label="Primary">
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => {
            const active = isNavItemActive(item, pathname);
            const Icon = item.icon;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    active
                      ? "bg-brand-soft text-brand"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="size-4.5 shrink-0" aria-hidden />
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

    </aside>
  );
}
