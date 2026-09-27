import Link from "next/link";
import { LifeBuoy, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { telegramSupportUrl } from "@/lib/support";
import { cn } from "@/lib/utils";

/**
 * "Contact Support on Telegram", or an honest fallback when no Telegram
 * handle is configured (`@/lib/support`). Used by the deposit screen when a
 * transaction cannot be resolved automatically, and by Settings.
 *
 * No `"use client"`: it reads a build-time public value and renders a link,
 * so either side can use it.
 */
export function TelegramSupportButton({
  className,
  label = "Contact Support on Telegram",
}: {
  className?: string;
  label?: string;
}) {
  const url = telegramSupportUrl();

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
