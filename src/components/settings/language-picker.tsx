"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { PrototypeNote } from "@/components/shared/notices";
import { cn } from "@/lib/utils";

/**
 * Language selection. English is the only language shipped in this build;
 * the others are listed so the surface exists for a future i18n integration.
 */
const LANGUAGES = [
  { id: "en", label: "English", native: "English", available: true },
  { id: "hi", label: "Hindi", native: "हिन्दी", available: false },
  { id: "mr", label: "Marathi", native: "मराठी", available: false },
  { id: "ta", label: "Tamil", native: "தமிழ்", available: false },
  { id: "te", label: "Telugu", native: "తెలుగు", available: false },
] as const;

export function LanguagePicker() {
  const [selected, setSelected] = useState("en");

  return (
    <div className="space-y-5">
      <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {LANGUAGES.map((language) => {
          const active = language.id === selected;
          return (
            <li key={language.id}>
              <button
                type="button"
                disabled={!language.available}
                onClick={() => {
                  setSelected(language.id);
                  toast.success(`Language set to ${language.label}`);
                }}
                aria-pressed={active}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  language.available
                    ? "hover:bg-secondary/60"
                    : "cursor-not-allowed opacity-55",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {language.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {language.native}
                    {!language.available ? " · coming soon" : ""}
                  </span>
                </span>
                {active ? (
                  <Check className="size-4 shrink-0 text-brand" aria-hidden />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <PrototypeNote>
        Only English is available at the moment. Other languages will be added
        here as they become available.
      </PrototypeNote>
    </div>
  );
}
