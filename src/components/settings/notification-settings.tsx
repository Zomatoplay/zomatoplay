"use client";

import { Bell } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Switch } from "@/components/ui/switch";
import { notificationPreferences, notifications } from "@/data/notifications";
import { usePrototypeStore } from "@/lib/prototype-store";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/format";

export function NotificationSettings() {
  const { notificationPrefs, toggleNotification } = usePrototypeStore();

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recent
        </h2>
        {notifications.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5",
                  !notification.read && "bg-brand-soft/40",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    notification.read ? "bg-transparent" : "bg-brand",
                  )}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {notification.title}
                    {!notification.read ? (
                      <span className="sr-only"> (unread)</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {notification.body}
                  </p>
                  <p className="tabular mt-1.5 text-[11px] text-muted-foreground">
                    {formatDateTime(notification.date)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={Bell}
            title="No notifications"
            description="Alerts about your account will appear here."
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          What you get notified about
        </h2>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {notificationPreferences.map((preference) => (
            <div
              key={preference.id}
              className="flex min-h-14 items-center gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {preference.label}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {preference.description}
                </p>
              </div>
              <Switch
                checked={notificationPrefs[preference.id]}
                onCheckedChange={() => toggleNotification(preference.id)}
                aria-label={preference.label}
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
