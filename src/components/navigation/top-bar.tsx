import Link from "next/link";
import { Bell } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { currentUser } from "@/data/user";
import { unreadNotificationCount } from "@/data/notifications";
import { initials } from "@/utils/format";
import { cn } from "@/lib/utils";

interface TopBarProps {
  /** Small line above the title, e.g. "Good evening". */
  eyebrow?: string;
  title: string;
  /** Show the avatar + notification controls. Default `true`. */
  showActions?: boolean;
  className?: string;
}

/**
 * Header for the five primary sections. Sticky so the section name and the
 * notification control stay reachable while the page scrolls.
 */
export function TopBar({
  eyebrow,
  title,
  showActions = true,
  className,
}: TopBarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 bg-background/90 backdrop-blur-md",
        className,
      )}
    >
      <div className="pt-safe" />
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <p className="truncate text-xs font-medium text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        </div>

        {showActions ? (
          <div className="flex shrink-0 items-center gap-1">
            <Link
              href="/settings/notifications"
              aria-label={
                unreadNotificationCount > 0
                  ? `Notifications, ${unreadNotificationCount} unread`
                  : "Notifications"
              }
              className="relative flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Bell className="size-5" strokeWidth={1.9} />
              {unreadNotificationCount > 0 ? (
                <span className="absolute right-2 top-2 size-2 rounded-full bg-brand ring-2 ring-background" />
              ) : null}
            </Link>
            <Link
              href="/settings"
              aria-label="Your profile"
              className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Avatar className="size-9">
                <AvatarFallback className="text-xs">
                  {initials(currentUser.fullName)}
                </AvatarFallback>
              </Avatar>
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}
