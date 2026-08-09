import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  title: string;
  description?: string;
  /** Optional "see all" style link. */
  action?: { label: string; href: string };
  className?: string;
  /** Heading level for correct document outline. */
  as?: "h2" | "h3";
}

export function SectionHeader({
  title,
  description,
  action,
  className,
  as: Heading = "h2",
}: SectionHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <Heading className="text-base font-semibold tracking-tight text-foreground">
          {title}
        </Heading>
        {description ? (
          <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? (
        <Link
          href={action.href}
          className="-mr-1 inline-flex shrink-0 items-center gap-0.5 rounded-full px-1 py-1 text-sm font-medium text-brand transition-colors hover:text-brand/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {action.label}
          <ChevronRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}
