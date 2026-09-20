import { Suspense } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  getUnreadNotificationCount,
  getUserSlices,
} from "@/server/services/account.service";
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
 *
 * SYNCHRONOUS, DELIBERATELY
 * -------------------------
 * The title and eyebrow are props — they are known before any read — so this
 * component renders them immediately and suspends only the two controls that
 * genuinely need the account.
 *
 * It used to be an async component that awaited a profile and an unread count
 * before emitting anything, including the heading. That put a database round
 * trip in front of the page title on all five primary sections, and because
 * `showActions={false}` on Settings never renders either value, Settings paid
 * for two reads it did not use.
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
          <Suspense fallback={<TopBarActionsPlaceholder />}>
            <TopBarActions />
          </Suspense>
        ) : null}
      </div>
    </header>
  );
}

/**
 * The account-dependent controls: an unread badge and the avatar's initials.
 *
 * A name and a number, and nothing else. This used to read the `notifications`
 * slice — every notification the account had ever received — purely to compute
 * `unreadCount` with a `filter().length`. That is a `count(*)` written as a
 * full table read, and because this renders on Home, Wallet, Referral, Plans
 * and Settings, every one of those pages fetched and serialised the whole list
 * to render a badge.
 *
 * Both reads are request-memoised, so a page that also reads `profile` shares
 * this one rather than issuing a second.
 */
async function TopBarActions() {
  const [{ profile }, unreadCount] = await Promise.all([
    // Through the page funnel, so an absent session redirects rather than
    // throwing — this renders inside pages, which race the layout's gate.
    getUserSlices(["profile"] as const),
    getUnreadNotificationCount(),
  ]);

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Link
        href="/settings/notifications"
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        className="relative flex size-10 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Bell className="size-5" strokeWidth={1.9} />
        {unreadCount > 0 ? (
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
            {initials(profile.fullName)}
          </AvatarFallback>
        </Avatar>
      </Link>
    </div>
  );
}

/**
 * Holds the controls' space while they resolve.
 *
 * Renders no initial and no badge: an avatar showing a placeholder letter
 * would be a fabricated identity, and a badge would be a fabricated count.
 * The notification link stays present and usable because its destination does
 * not depend on the read.
 */
function TopBarActionsPlaceholder() {
  return (
    <div className="flex shrink-0 items-center gap-1" aria-hidden>
      <span className="flex size-10 items-center justify-center rounded-full text-muted-foreground/40">
        <Bell className="size-5" strokeWidth={1.9} />
      </span>
      <span className="size-9 animate-pulse rounded-full bg-secondary" />
    </div>
  );
}
