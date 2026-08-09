import { cn } from "@/lib/utils";

interface InfoRowProps {
  label: string;
  value: React.ReactNode;
  /** Secondary line under the value, e.g. an INR equivalent. */
  hint?: React.ReactNode;
  emphasis?: boolean;
  className?: string;
}

/**
 * Label/value row used in summaries, quotes and detail panels.
 * Wraps rather than truncating so long values stay readable at 360px.
 */
export function InfoRow({
  label,
  value,
  hint,
  emphasis = false,
  className,
}: InfoRowProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 py-2.5 text-sm",
        className,
      )}
    >
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="flex min-w-0 flex-col items-end text-right">
        <span
          className={cn(
            "tabular break-words",
            emphasis
              ? "text-base font-semibold text-foreground"
              : "font-medium text-foreground",
          )}
        >
          {value}
        </span>
        {hint ? (
          <span className="tabular text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </span>
    </div>
  );
}
