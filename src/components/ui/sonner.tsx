"use client";

import { Toaster as Sonner } from "sonner";

/**
 * Toasts are offset above the fixed bottom navigation so they never sit
 * underneath it on mobile.
 */
function Toaster(props: React.ComponentProps<typeof Sonner>) {
  return (
    <Sonner
      position="top-center"
      offset={16}
      duration={3200}
      toastOptions={{
        classNames: {
          toast:
            "group flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg",
          title: "font-medium",
          description: "text-muted-foreground text-xs",
          actionButton: "rounded-full bg-primary px-3 py-1 text-primary-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
