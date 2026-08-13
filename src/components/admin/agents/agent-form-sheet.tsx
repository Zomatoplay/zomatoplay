"use client";

import { useState } from "react";

import { PermissionMatrix } from "@/components/admin/shared/permission-matrix";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
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
import { AGENT_PRESETS } from "@/constants/admin";
import type { AgentDraft } from "@/lib/admin-store";
import { cn } from "@/lib/utils";
import type { AdminAgent, AdminPermissionSet } from "@/types/admin";

/**
 * Create / edit form for an operator account.
 *
 * Creation starts from a role preset rather than thirteen empty toggles.
 * Presets are a starting point, not a constraint — the matrix below stays fully
 * editable, and choosing one simply seeds it.
 */

function emptyDraft(): AgentDraft {
  return {
    name: "",
    email: "",
    permissions: AGENT_PRESETS[0].permissions,
    note: "",
  };
}

function toDraft(agent: AdminAgent): AgentDraft {
  return {
    name: agent.name,
    email: agent.email,
    permissions: agent.permissions,
    note: agent.note ?? "",
  };
}

export function AgentFormSheet({
  mode,
  agent,
  open,
  onOpenChange,
  onSubmit,
}: {
  mode: "create" | "edit";
  agent?: AdminAgent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (draft: AgentDraft) => void;
}) {
  const [draft, setDraft] = useState<AgentDraft>(
    agent ? toDraft(agent) : emptyDraft(),
  );
  const [preset, setPreset] = useState<string>(
    mode === "create" ? AGENT_PRESETS[0].id : "custom",
  );
  const [touched, setTouched] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(agent ? toDraft(agent) : emptyDraft());
      setPreset(mode === "create" ? AGENT_PRESETS[0].id : "custom");
      setTouched(false);
    }
    onOpenChange(next);
  }

  function applyPreset(id: string) {
    const found = AGENT_PRESETS.find((entry) => entry.id === id);
    if (!found) return;
    setPreset(id);
    setDraft((current) => ({ ...current, permissions: found.permissions }));
  }

  function setPermissions(permissions: AdminPermissionSet) {
    setDraft((current) => ({ ...current, permissions }));
    // Any hand edit means the set no longer matches a named preset.
    setPreset("custom");
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim());
  const valid = draft.name.trim() !== "" && emailValid;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>
            {mode === "create" ? "Create agent" : `Edit ${agent?.name ?? "agent"}`}
          </SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "The agent is created in an invited state and receives a sign-in link. No authentication exists in this prototype."
              : "Changes take effect immediately and are written to the audit log."}
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="agent-name">Full name</Label>
              <Input
                id="agent-name"
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Divya Nambiar"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-email">Work email</Label>
              <Input
                id="agent-email"
                type="email"
                value={draft.email}
                onChange={(event) =>
                  setDraft({ ...draft, email: event.target.value })
                }
                placeholder="name@nanotron.app"
                aria-invalid={touched && !emailValid}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-note">Note</Label>
            <Textarea
              id="agent-note"
              value={draft.note}
              onChange={(event) =>
                setDraft({ ...draft, note: event.target.value })
              }
              placeholder="What this agent is responsible for…"
              className="min-h-20 text-sm"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Start from a role</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {AGENT_PRESETS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => applyPreset(entry.id)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    preset === entry.id
                      ? "border-brand bg-brand-soft"
                      : "border-border hover:bg-secondary",
                  )}
                >
                  <span
                    className={cn(
                      "block text-sm font-medium",
                      preset === entry.id ? "text-brand" : "text-foreground",
                    )}
                  >
                    {entry.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    {entry.description}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Permissions</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Adjust any row individually. Editing a row switches the role above
              to Custom.
            </p>
            <PermissionMatrix
              permissions={draft.permissions}
              onChange={(id, level) =>
                setPermissions({ ...draft.permissions, [id]: level })
              }
            />
          </div>

          {touched && !valid ? (
            <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-destructive">
              A name and a valid work email address are required.
            </p>
          ) : null}
        </SheetBody>

        <SheetFooter className="sm:flex-row-reverse">
          <Button
            variant="brand"
            block
            className="sm:w-auto sm:flex-1"
            onClick={() => {
              setTouched(true);
              if (!valid) return;
              onSubmit({
                ...draft,
                name: draft.name.trim(),
                email: draft.email.trim(),
                note: draft.note?.trim() || undefined,
              });
              onOpenChange(false);
            }}
          >
            {mode === "create" ? "Create agent" : "Save changes"}
          </Button>
          <Button
            variant="outline"
            block
            className="sm:w-auto sm:flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
