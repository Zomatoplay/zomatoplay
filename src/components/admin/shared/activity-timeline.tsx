import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatDateTime } from "@/utils/format";

/**
 * Chronological event list used for security events, KYC case history and the
 * per-user activity tab.
 *
 * Marked up as an ordered list because the order is the information. The
 * connecting rule is decorative and hidden from assistive technology.
 */

export interface TimelineEntry {
  id: string;
  title: string;
  description?: React.ReactNode;
  /** ISO timestamp. Formatted UTC-pinned to avoid hydration mismatches. */
  timestamp: string;
  icon: LucideIcon;
  tone?: "default" | "positive" | "warning" | "negative";
  /** Secondary line, e.g. device · IP · location. */
  meta?: string;
}

const toneStyles = {
  default: "bg-secondary text-muted-foreground",
  positive: "bg-brand-soft text-brand",
  warning: "bg-warning/12 text-warning",
  negative: "bg-destructive/10 text-destructive",
} as const;

export function ActivityTimeline({
  entries,
  className,
}: {
  entries: TimelineEntry[];
  className?: string;
}) {
  if (entries.length === 0) {
    return (
      <p className={cn("py-6 text-center text-sm text-muted-foreground", className)}>
        No activity recorded.
      </p>
    );
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      {entries.map((entry, index) => {
        const Icon = entry.icon;
        const isLast = index === entries.length - 1;
        return (
          <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector. Decorative — the list order carries the meaning. */}
            {!isLast ? (
              <span
                className="absolute left-[15px] top-8 bottom-0 w-px bg-border"
                aria-hidden
              />
            ) : null}

            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full",
                toneStyles[entry.tone ?? "default"],
              )}
            >
              <Icon className="size-4" aria-hidden />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {entry.title}
                </p>
                <time
                  dateTime={entry.timestamp}
                  className="tabular shrink-0 text-xs text-muted-foreground"
                >
                  {formatDateTime(entry.timestamp)}
                </time>
              </div>
              {entry.description ? (
                <div className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                  {entry.description}
                </div>
              ) : null}
              {entry.meta ? (
                <p className="mt-1 text-xs text-muted-foreground">{entry.meta}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
