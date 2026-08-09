"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { PRIMARY_NAV, isNavItemActive } from "@/constants/navigation";
import { cn } from "@/lib/utils";

/**
 * Fixed mobile bottom navigation.
 *
 * Height is 4.5rem plus the device safe-area inset; every scrollable page
 * reserves exactly that space via the `.pb-nav` utility, so content is never
 * covered. Hidden from `lg` upward where the sidebar takes over.
 */
export function BottomNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto flex h-[4.5rem] w-full max-w-lg items-stretch">
        {PRIMARY_NAV.map((item) => {
          const active = isNavItemActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-1 px-1 pt-1 transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring",
                  active
                    ? "text-brand"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-brand-soft",
                  )}
                >
                  <Icon
                    className="size-5"
                    strokeWidth={active ? 2.3 : 1.9}
                    aria-hidden
                  />
                </span>
                <span
                  className={cn(
                    "text-[11px] leading-none",
                    active ? "font-semibold" : "font-medium",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Extends the bar's background into the gesture-bar area. */}
      <div className="pb-safe" />
    </nav>
  );
}
