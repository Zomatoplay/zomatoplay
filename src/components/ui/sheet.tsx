"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Sheet dialog. Built on Radix Dialog so focus trapping, escape handling and
 * ARIA wiring come for free.
 *
 * Two placements:
 *   `bottom` (default) — slides up from the bottom edge on mobile, the expected
 *                        pattern for a native finance app; becomes a centred
 *                        modal from `sm` upward.
 *   `left`             — a full-height edge drawer at every width. Used by the
 *                        Master CRM's mobile navigation, where a bottom sheet
 *                        would be the wrong shape for a long nav list.
 */

const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetPortal = SheetPrimitive.Portal;

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-foreground/40 backdrop-blur-[2px]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  showClose = true,
  side = "bottom",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  showClose?: boolean;
  side?: "bottom" | "left";
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-card text-card-foreground",
          "data-[state=open]:animate-in data-[state=closed]:animate-out duration-200",
          side === "bottom" && [
            // Mobile: full-width bottom sheet, capped so it never covers the
            // whole viewport, with its own internal scroll.
            "inset-x-0 bottom-0 max-h-[92svh] rounded-t-3xl border-t border-border",
            "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
            // Desktop: centred modal.
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-md",
            "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border",
            "sm:data-[state=open]:slide-in-from-bottom-2 sm:data-[state=closed]:slide-out-to-bottom-2",
          ],
          side === "left" && [
            "inset-y-0 left-0 w-[17rem] max-w-[85vw] border-r border-border",
            "data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
          ],
          className,
        )}
        {...props}
      >
        {/* Drag affordance — visual only, bottom sheet on mobile. */}
        {side === "bottom" ? (
          <div className="flex shrink-0 justify-center pt-3 sm:hidden" aria-hidden>
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>
        ) : null}
        {children}
        {showClose ? (
          <SheetPrimitive.Close
            className={cn(
              "absolute right-4 top-4 size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              // The bottom sheet is dismissed by dragging or tapping away on
              // mobile; the edge drawer always needs an explicit control.
              side === "bottom" ? "hidden sm:flex" : "flex",
            )}
            aria-label="Close"
          >
            <X className="size-4" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex shrink-0 flex-col gap-1.5 px-5 pb-2 pt-4", className)}
      {...props}
    />
  );
}

function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-2", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "flex shrink-0 flex-col gap-2 px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3",
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-lg font-semibold leading-tight", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm leading-relaxed text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
