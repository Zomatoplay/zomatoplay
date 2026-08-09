import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface ListRowBaseProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Rendered at the right edge, before the chevron. */
  meta?: React.ReactNode;
  className?: string;
  /** Hide the trailing chevron (e.g. when `meta` is a switch). */
  hideChevron?: boolean;
  destructive?: boolean;
}

type ListRowProps = ListRowBaseProps &
  (
    | { href: string; onClick?: never; as?: never }
    | { href?: never; onClick: () => void; as?: never }
    | { href?: never; onClick?: never; as: "div" }
  );

function RowInner({
  icon: Icon,
  title,
  description,
  meta,
  hideChevron,
  destructive,
  interactive,
}: ListRowBaseProps & { interactive: boolean }) {
  return (
    <>
      {Icon ? (
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            destructive
              ? "bg-destructive/10 text-destructive"
              : "bg-secondary text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            "block text-sm font-medium",
            destructive ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {meta ? <span className="shrink-0">{meta}</span> : null}
      {interactive && !hideChevron ? (
        <ChevronRight
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      ) : null}
    </>
  );
}

/**
 * The row primitive behind Settings lists and other tappable lists.
 * Minimum height 56px keeps every row a comfortable touch target.
 */
export function ListRow({ href, onClick, as, className, ...rest }: ListRowProps) {
  const shared = cn(
    "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors",
    (href || onClick) &&
      "hover:bg-secondary/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={shared}>
        <RowInner {...rest} interactive />
      </Link>
    );
  }

  if (as === "div") {
    return (
      <div className={shared}>
        <RowInner {...rest} interactive={false} />
      </div>
    );
  }

  return (
    <button type="button" onClick={onClick} className={shared}>
      <RowInner {...rest} interactive />
    </button>
  );
}

/**
 * Groups rows into a single rounded card with hairline dividers.
 */
export function ListGroup({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-2", className)}>
      {title ? (
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}
