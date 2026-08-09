"use client";

import { useState } from "react";
import { Layers } from "lucide-react";

import { PlanCard } from "@/components/plans/plan-card";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import type { Plan, RiskLevel } from "@/types";

type Filter = "all" | RiskLevel;

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All plans" },
  { id: "conservative", label: "Conservative" },
  { id: "balanced", label: "Balanced" },
  { id: "growth", label: "Growth" },
];

/**
 * Filterable plan list. The filter row scrolls horizontally inside its own
 * container so it never forces the page to scroll sideways at 360px.
 */
export function PlansBrowser({ plans }: { plans: Plan[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const visible =
    filter === "all" ? plans : plans.filter((plan) => plan.risk === filter);

  return (
    <div className="space-y-4">
      {/* Negative margins let the row bleed to the screen edge while the
          padding keeps the first and last chip clear of it. */}
      <div
        className="no-scrollbar edge-scroll -mx-4 overflow-x-auto px-4"
        role="group"
        aria-label="Filter plans by risk"
      >
        <div className="flex w-max gap-2">
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                aria-pressed={active}
                className={cn(
                  "h-9 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {visible.length > 0 ? (
        <div className="space-y-4">
          {visible.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Layers}
          title="No plans in this category"
          description="Try a different risk level to see more options."
        />
      )}
    </div>
  );
}
