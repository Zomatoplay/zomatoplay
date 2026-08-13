"use client";

import { useState } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Confirmation step for destructive or sensitive administrative actions.
 *
 * Every action that changes a user's access, moves money or alters an operator
 * account goes through this. Two things it deliberately does:
 *
 *   - Names the subject in the body. "Block this user?" is easy to click on the
 *     wrong row; "Block Karan Joshi (NT-4820199)?" is not.
 *   - Can require a typed reason. Where an audit entry will be written and the
 *     user will be told why, a free-text reason is not optional bureaucracy —
 *     it is the content of that message.
 */

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen, in plain words. Name the subject here. */
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: (reason: string) => void;
  /** Styles the confirm control as destructive. */
  destructive?: boolean;
  /** Collect a reason. When `required`, confirm stays disabled until one is given. */
  reason?: {
    label: string;
    placeholder?: string;
    required?: boolean;
    /** Quick-pick reasons, so common cases need no typing. */
    presets?: string[];
  };
  /** Extra content between the description and the reason field. */
  children?: React.ReactNode;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  reason,
  children,
}: ConfirmActionDialogProps) {
  const [value, setValue] = useState("");

  const canConfirm = !reason?.required || value.trim().length > 0;

  function handleOpenChange(next: boolean) {
    if (!next) setValue("");
    onOpenChange(next);
  }

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(value.trim());
    setValue("");
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-start gap-3">
            {destructive ? (
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <TriangleAlert className="size-4" aria-hidden />
              </span>
            ) : null}
            <div className="min-w-0">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription className="mt-1">{description}</SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-4">
          {children}

          {reason ? (
            <div className="space-y-2">
              <Label htmlFor="confirm-reason">
                {reason.label}
                {reason.required ? null : (
                  <span className="ml-1 font-normal text-muted-foreground">
                    (optional)
                  </span>
                )}
              </Label>

              {reason.presets && reason.presets.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {reason.presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setValue(preset)}
                      className={cn(
                        "rounded-full border px-2.5 py-1.5 text-left text-xs leading-snug transition-colors",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        value === preset
                          ? "border-transparent bg-brand-soft text-brand"
                          : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              ) : null}

              <Textarea
                id="confirm-reason"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                placeholder={reason.placeholder}
                className="min-h-20 text-sm"
              />
              <p className="text-xs text-muted-foreground">
                This is recorded in the audit log.
              </p>
            </div>
          ) : null}
        </SheetBody>

        <SheetFooter className="sm:flex-row-reverse">
          <Button
            variant={destructive ? "destructive" : "brand"}
            onClick={handleConfirm}
            disabled={!canConfirm}
            block
            className="sm:w-auto sm:flex-1"
          >
            {confirmLabel}
          </Button>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            block
            className="sm:w-auto sm:flex-1"
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Manages the open/closed state of a single confirmation dialog driven by a
 * list of possible actions, so a screen with a dozen actions needs one dialog
 * rather than a dozen pieces of state.
 */
export function useConfirmAction<T extends string>() {
  const [pending, setPending] = useState<T | null>(null);
  return {
    pending,
    request: (action: T) => setPending(action),
    dismiss: () => setPending(null),
    isOpen: (action: T) => pending === action,
    setOpen: (action: T) => (open: boolean) =>
      setPending(open ? action : null),
  };
}
