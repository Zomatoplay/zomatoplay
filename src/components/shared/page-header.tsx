import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  /** Parent route for the back control. Rendered as a real link, so it works
   *  on a cold load / shared URL where there is no history to pop. */
  backHref: string;
  backLabel?: string;
  /** Optional control on the right (e.g. a help button). */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Sticky header for secondary screens. Sits above the scrolling content and
 * respects the top safe-area inset.
 */
export function PageHeader({
  title,
  backHref,
  backLabel = "Back",
  action,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md",
        className,
      )}
    >
      <div className="pt-safe" />
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center gap-1 px-2">
        <Link
          href={backHref}
          aria-label={backLabel}
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">
          {title}
        </h1>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </header>
  );
}
