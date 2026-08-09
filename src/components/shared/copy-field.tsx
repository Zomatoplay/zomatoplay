"use client";

import { Check, Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

interface CopyFieldProps {
  /** Value copied to the clipboard. */
  value: string;
  /** Optional shorter text to display instead of the raw value. */
  display?: string;
  label?: string;
  /** Toast message on success. */
  successMessage?: string;
  className?: string;
  /** Allow the value to wrap across lines (useful for long addresses). */
  wrap?: boolean;
}

export function CopyField({
  value,
  display,
  label,
  successMessage = "Copied to clipboard",
  className,
  wrap = true,
}: CopyFieldProps) {
  const { copy, copied } = useCopyToClipboard();

  async function handleCopy() {
    const ok = await copy(value);
    toast[ok ? "success" : "error"](ok ? successMessage : "Could not copy");
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
      ) : null}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-secondary/60 p-2 pl-3">
        <span
          className={cn(
            "min-w-0 flex-1 font-mono text-xs leading-relaxed text-foreground",
            wrap ? "break-all" : "truncate",
          )}
        >
          {display ?? value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : `Copy ${label ?? "value"}`}
        >
          {copied ? (
            <Check className="size-4 text-positive" />
          ) : (
            <Copy className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

/** Compact icon-only copy control, for use inside dense rows. */
export function CopyButton({
  value,
  label = "value",
  successMessage = "Copied to clipboard",
  className,
}: {
  value: string;
  label?: string;
  successMessage?: string;
  className?: string;
}) {
  const { copy, copied } = useCopyToClipboard();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className={className}
      aria-label={copied ? "Copied" : `Copy ${label}`}
      onClick={async () => {
        const ok = await copy(value);
        toast[ok ? "success" : "error"](ok ? successMessage : "Could not copy");
      }}
    >
      {copied ? (
        <Check className="size-4 text-positive" />
      ) : (
        <Copy className="size-4" />
      )}
    </Button>
  );
}
