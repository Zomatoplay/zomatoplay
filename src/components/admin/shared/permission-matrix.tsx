"use client";

import { Check, Eye, Minus, ShieldCheck } from "lucide-react";

import { ADMIN_PERMISSIONS } from "@/constants/admin";
import { PERMISSION_LEVEL_LABELS } from "@/lib/admin-permissions";
import { cn } from "@/lib/utils";
import type {
  AdminPermissionId,
  AdminPermissionLevel,
  AdminPermissionSet,
} from "@/types/admin";

/**
 * The permission matrix — one row per governable area, three levels per row.
 *
 * Rendered as a radiogroup per row rather than a grid of checkboxes: the levels
 * are mutually exclusive, and a radiogroup is what assistive technology should
 * be told. Each level carries an icon and a label so the selected state is
 * never signalled by colour alone.
 *
 * In read-only mode the same component renders the assigned levels, so an
 * operator reviewing an agent sees exactly the layout they would edit.
 */

const LEVELS: AdminPermissionLevel[] = ["none", "view", "manage"];

const LEVEL_ICONS: Record<
  AdminPermissionLevel,
  React.ComponentType<{ className?: string }>
> = {
  none: Minus,
  view: Eye,
  manage: ShieldCheck,
};

const LEVEL_ACTIVE_STYLES: Record<AdminPermissionLevel, string> = {
  none: "border-transparent bg-secondary text-muted-foreground",
  view: "border-transparent bg-info/10 text-info",
  manage: "border-transparent bg-brand-soft text-brand",
};

export function PermissionMatrix({
  permissions,
  onChange,
  /** Master admins hold everything implicitly; the matrix is informational. */
  readOnly = false,
  className,
}: {
  permissions: AdminPermissionSet;
  onChange?: (id: AdminPermissionId, level: AdminPermissionLevel) => void;
  readOnly?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {ADMIN_PERMISSIONS.map((descriptor) => {
        const current = permissions[descriptor.id] ?? "none";
        return (
          <div
            key={descriptor.id}
            className="flex flex-col gap-2.5 rounded-xl border border-border p-3 lg:flex-row lg:items-center lg:justify-between lg:gap-6"
          >
            <div className="min-w-0 lg:flex-1">
              <p className="text-sm font-medium text-foreground">
                {descriptor.label}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {descriptor.description}
                {current === "manage" ? (
                  <>
                    {" "}
                    <span className="text-foreground">
                      {descriptor.manageHint}
                    </span>
                  </>
                ) : null}
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label={`${descriptor.label} access level`}
              className="flex shrink-0 gap-1"
            >
              {LEVELS.map((level) => {
                const active = current === level;
                const Icon = LEVEL_ICONS[level];
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={readOnly}
                    onClick={() => onChange?.(descriptor.id, level)}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      active
                        ? LEVEL_ACTIVE_STYLES[level]
                        : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground",
                      readOnly && "pointer-events-none",
                      readOnly && !active && "opacity-40",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                    {PERMISSION_LEVEL_LABELS[level]}
                    {active && readOnly ? (
                      <Check className="size-3" aria-hidden />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Compact summary of a permission set, for agent table rows. */
export function PermissionSummary({
  counts,
  className,
}: {
  counts: { none: number; view: number; manage: number };
  className?: string;
}) {
  return (
    <span
      className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1", className)}
    >
      <span className="inline-flex items-center gap-1 text-xs text-brand">
        <ShieldCheck className="size-3" aria-hidden />
        <span className="tabular">{counts.manage}</span> full
      </span>
      <span className="inline-flex items-center gap-1 text-xs text-info">
        <Eye className="size-3" aria-hidden />
        <span className="tabular">{counts.view}</span> view
      </span>
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Minus className="size-3" aria-hidden />
        <span className="tabular">{counts.none}</span> none
      </span>
    </span>
  );
}
