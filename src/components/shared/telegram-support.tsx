import Link from "next/link";
import { LifeBuoy, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * "Contact Support on Telegram", or an honest fallback when no Telegram
 * destination is configured. Used by the deposit screen when a transaction
 * cannot be resolved automatically.
 *
 * The URL arrives as a prop, read server-side by `getSupportTelegramUrl()`
 * (the operator's saved setting, already validated to a `t.me` link). No
 * `"use client"`, so either side can render it.
 */
export function TelegramSupportButton({
  url,
  className,
  label = "Contact Support on Telegram",
}: {
  url: string | null;
  className?: string;
  label?: string;
}) {

  if (!url) {
    return (
      <Button asChild variant="outline" size="lg" block className={className}>
        <Link href="/settings/support">
          <LifeBuoy className="size-4" aria-hidden />
          Contact support
        </Link>
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size="lg" block className={cn(className)}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Send className="size-4" aria-hidden />
        {label}
        <span className="sr-only"> (opens Telegram)</span>
      </a>
    </Button>
  );
}
