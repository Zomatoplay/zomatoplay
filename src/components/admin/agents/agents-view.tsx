"use client";

import { useMemo, useState } from "react";
import {
  KeyRound,
  Plus,
  Power,
  PowerOff,
  ShieldCheck,
  SlidersHorizontal,
  UserCog,
} from "lucide-react";

import { AgentFormSheet } from "@/components/admin/agents/agent-form-sheet";
import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import { AuditLogTable } from "@/components/admin/shared/audit-log-table";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import { DetailCard } from "@/components/admin/shared/detail-list";
import {
  FilterBar,
  FilterChips,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import {
  PermissionMatrix,
  PermissionSummary,
} from "@/components/admin/shared/permission-matrix";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { canManage, summarisePermissions } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import {
  createAgentAction,
  endAgentSessionsAction,
  setAgentDisabledAction,
  updateAgentAction,
} from "@/app/admin/actions";
import type { AdminAgent, AdminPermissionSet, AgentStatus } from "@/types/admin";
import { formatDate, formatDateTime } from "@/utils/format";

/**
 * Agent management.
 *
 * Only a master admin can reach this screen with manage rights. The master
 * admin's own record is deliberately not editable or disableable from the UI —
 * an operations console that can lock out its owner is a support incident
 * waiting to happen.
 */

type StatusFilter = "all" | AgentStatus;

export function AgentsView() {
  return (
    <>
      <AdminHeader
        title="Agents"
        description="Operator accounts and the permissions assigned to each of them."
      />
      <AdminPage>
        <PermissionGate permission="agents">
          <AgentsManager />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function AgentsManager() {
  const store = useAdminStore();
  const { run } = useAdminAction();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminAgent | null>(null);
  const [permissionsFor, setPermissionsFor] = useState<AdminAgent | null>(null);
  const [toggling, setToggling] = useState<AdminAgent | null>(null);
  const [resetting, setResetting] = useState<AdminAgent | null>(null);
  const [activityFor, setActivityFor] = useState<AdminAgent | null>(null);

  const allowed = canManage(store.session, "agents");
  const agents = store.agents;

  const options: FilterOption<StatusFilter>[] = useMemo(() => {
    const count = (value: AgentStatus) =>
      agents.filter((agent) => agent.status === value).length;
    return [
      { value: "all", label: "All", count: agents.length },
      { value: "active", label: "Active", count: count("active") },
      { value: "invited", label: "Invited", count: count("invited") },
      { value: "disabled", label: "Disabled", count: count("disabled") },
    ];
  }, [agents]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return agents.filter((agent) => {
      if (status !== "all" && agent.status !== status) return false;
      if (!needle) return true;
      return [agent.name, agent.email, agent.note ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [agents, query, status]);

  const columns: DataTableColumn<AdminAgent>[] = [
    {
      id: "agent",
      header: "Agent",
      cell: (agent) => (
        <PrimaryCell
          title={
            <>
              {agent.name}
              {agent.role === "master_admin" ? (
                <Badge variant="brand" className="ml-2">
                  <ShieldCheck className="size-3" aria-hidden />
                  Master
                </Badge>
              ) : null}
            </>
          }
          subtitle={
            <>
              {agent.email}
              {agent.phoneMasked ? (
                <span className="block tabular">
                  {agent.phoneMasked}
                  {agent.phoneVerified ? "" : " · not yet verified"}
                </span>
              ) : (
                <span className="block text-warning">No sign-in number</span>
              )}
            </>
          }
        />
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (agent) => <AdminStatusBadge kind="agent" status={agent.status} />,
    },
    {
      id: "permissions",
      header: "Permissions",
      hideBelow: "lg",
      cell: (agent) =>
        agent.role === "master_admin" ? (
          <span className="text-xs text-muted-foreground">
            Full access to everything
          </span>
        ) : (
          <PermissionSummary counts={summarisePermissions(agent.permissions)} />
        ),
    },
    {
      id: "created",
      header: "Created",
      numeric: true,
      hideBelow: "xl",
      cell: (agent) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(agent.createdAt)}
        </span>
      ),
    },
    {
      id: "lastActive",
      header: "Last active",
      numeric: true,
      hideBelow: "lg",
      cell: (agent) => (
        <span className="text-xs text-muted-foreground">
          {agent.lastActiveAt ? formatDateTime(agent.lastActiveAt) : "Never"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      srOnlyHeader: true,
      numeric: true,
      cell: (agent) => {
        const isMaster = agent.role === "master_admin";
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for ${agent.name}`}
              >
                <SlidersHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                disabled={!allowed || isMaster}
                onSelect={() => setEditing(agent)}
              >
                <UserCog />
                Edit agent
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!allowed || isMaster}
                onSelect={() => setPermissionsFor(agent)}
              >
                <ShieldCheck />
                Assign permissions
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!allowed}
                onSelect={() => setResetting(agent)}
              >
                <KeyRound />
                End sessions
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setActivityFor(agent)}>
                <SlidersHorizontal />
                View activity
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive={agent.status !== "disabled"}
                disabled={!allowed || isMaster}
                onSelect={() => setToggling(agent)}
              >
                {agent.status === "disabled" ? <Power /> : <PowerOff />}
                {agent.status === "disabled" ? "Enable agent" : "Disable agent"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <AdminSection
      className="space-y-4"
      actions={
        <Button
          variant="brand"
          size="sm"
          disabled={!allowed}
          onClick={() => setCreating(true)}
        >
          <Plus className="size-4" />
          Create agent
        </Button>
      }
    >
      {!allowed ? (
        <p className="rounded-xl border border-dashed border-border px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          You can see the agent directory but not change it. Only a master admin
          can create agents or assign permissions.
        </p>
      ) : null}

      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search agents"
          placeholder="Agent name, email or note"
        />
      </FilterBar>

      <FilterChips
        options={options}
        value={status}
        onChange={setStatus}
        label="Filter by agent status"
      />

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(agent) => agent.id}
        caption="Operator accounts with status and assigned permissions"
        empty={
          <EmptyState
            icon={UserCog}
            title="No matching agents"
            description="No operator account matches the current search and filters."
          />
        }
        renderCard={(agent) => (
          <DataCard>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{agent.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {agent.email}
                </p>
                <p className="tabular text-xs text-muted-foreground">
                  {agent.phoneMasked
                    ? `${agent.phoneMasked}${agent.phoneVerified ? "" : " · not yet verified"}`
                    : "No sign-in number"}
                </p>
              </div>
              <AdminStatusBadge kind="agent" status={agent.status} />
            </div>
            {agent.role === "master_admin" ? (
              <Badge variant="brand">
                <ShieldCheck className="size-3" aria-hidden />
                Master admin · full access
              </Badge>
            ) : (
              <PermissionSummary counts={summarisePermissions(agent.permissions)} />
            )}
            <DataCardRow label="Last active">
              <span className="tabular font-normal text-muted-foreground">
                {agent.lastActiveAt ? formatDate(agent.lastActiveAt) : "Never"}
              </span>
            </DataCardRow>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                disabled={!allowed || agent.role === "master_admin"}
                onClick={() => setPermissionsFor(agent)}
              >
                Permissions
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={() => setActivityFor(agent)}
              >
                Activity
              </Button>
            </div>
          </DataCard>
        )}
      />

      <DetailCard
        title="What the levels mean"
        description="Every governable area is set to one of three levels for each agent."
      >
        <ul className="grid gap-2 sm:grid-cols-3">
          <li className="rounded-xl border border-border p-3">
            <p className="text-sm font-medium">No access</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              The section is hidden from navigation entirely.
            </p>
          </li>
          <li className="rounded-xl border border-border p-3">
            <p className="text-sm font-medium text-info">View only</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              The agent can read records but every action is disabled.
            </p>
          </li>
          <li className="rounded-xl border border-border p-3">
            <p className="text-sm font-medium text-brand">Full access</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              The agent can act — approve, reject, edit and settle.
            </p>
          </li>
        </ul>
      </DetailCard>

      {/* ------------------------------------------------------ Dialogs */}

      <AgentFormSheet
        mode="create"
        open={creating}
        onOpenChange={setCreating}
        onSubmit={(draft) => {
          run(() => createAgentAction(draft), {
            onSuccess: () => setCreating(false),
          });
        }}
      />

      <AgentFormSheet
        mode="edit"
        agent={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSubmit={(draft) => {
          if (!editing) return;
          run(() => updateAgentAction({ agentId: editing.id, ...draft }), {
            onSuccess: () => setEditing(null),
          });
        }}
      />

      <PermissionsSheet
        agent={permissionsFor}
        onOpenChange={(open) => !open && setPermissionsFor(null)}
        onSave={(permissions) => {
          if (!permissionsFor) return;
          // Permissions travel with the rest of the operator record: one
          // action, one transaction, one audit entry. Splitting them would let
          // a name change succeed while the grants it accompanied did not.
          run(
            () =>
              updateAgentAction({
                agentId: permissionsFor.id,
                name: permissionsFor.name,
                email: permissionsFor.email,
                // Permissions only — the sign-in number is left as it is.
                note: permissionsFor.note,
                permissions,
              }),
            { onSuccess: () => setPermissionsFor(null) },
          );
        }}
      />

      <AgentActivitySheet
        agent={activityFor}
        onOpenChange={(open) => !open && setActivityFor(null)}
      />

      <ConfirmActionDialog
        open={toggling !== null}
        onOpenChange={(open) => !open && setToggling(null)}
        title={
          toggling?.status === "disabled" ? "Enable this agent?" : "Disable this agent?"
        }
        description={
          toggling ? (
            toggling.status === "disabled" ? (
              <>
                <strong className="font-medium text-foreground">
                  {toggling.name}
                </strong>{" "}
                will be able to sign in again with their existing permissions.
              </>
            ) : (
              <>
                <strong className="font-medium text-foreground">
                  {toggling.name}
                </strong>{" "}
                will lose access immediately. Their past actions stay in the
                audit log.
              </>
            )
          ) : null
        }
        confirmLabel={
          toggling?.status === "disabled" ? "Enable agent" : "Disable agent"
        }
        destructive={toggling?.status !== "disabled"}
        reason={{ label: "Reason", required: toggling?.status !== "disabled" }}
        onConfirm={(reason) => {
          if (!toggling) return;
          run(() =>
            setAgentDisabledAction({
              agentId: toggling.id,
              disabled: toggling.status !== "disabled",
              note: reason,
            }),
          );
          setToggling(null);
        }}
      />

      <ConfirmActionDialog
        open={resetting !== null}
        onOpenChange={(open) => !open && setResetting(null)}
        title="End this operator's sessions?"
        description={
          resetting ? (
            <>
              <strong className="font-medium text-foreground">{resetting.name}</strong>{" "}
              is signed out on every device at their next request. They can sign
              in again with their mobile number — disable them or change the
              number to stop that.
            </>
          ) : null
        }
        confirmLabel="End sessions"
        destructive
        reason={{ label: "Reason" }}
        onConfirm={(note) => {
          if (!resetting) return;
          run(() => endAgentSessionsAction({ agentId: resetting.id, note }));
          setResetting(null);
        }}
      />
    </AdminSection>
  );
}

/** Permission editor. Local until saved, so a cancelled edit changes nothing. */
function PermissionsSheet({
  agent,
  onOpenChange,
  onSave,
}: {
  agent: AdminAgent | null;
  onOpenChange: (open: boolean) => void;
  onSave: (permissions: AdminPermissionSet) => void;
}) {
  const [draft, setDraft] = useState<AdminPermissionSet | null>(null);
  const [lastAgentId, setLastAgentId] = useState<string | null>(null);

  // Re-seed whenever a different agent is opened.
  if (agent && agent.id !== lastAgentId) {
    setLastAgentId(agent.id);
    setDraft(agent.permissions);
  }

  const permissions = draft ?? agent?.permissions ?? null;

  return (
    <Sheet open={agent !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Assign permissions</SheetTitle>
          <SheetDescription>
            {agent
              ? `What ${agent.name} can see and do. Changes are written to the audit log.`
              : null}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          {permissions ? (
            <PermissionMatrix
              permissions={permissions}
              onChange={(id, level) =>
                setDraft({ ...permissions, [id]: level })
              }
            />
          ) : null}
        </SheetBody>

        <SheetFooter className="sm:flex-row-reverse">
          <Button
            variant="brand"
            block
            className="sm:w-auto sm:flex-1"
            onClick={() => {
              if (permissions) onSave(permissions);
              onOpenChange(false);
            }}
          >
            Save permissions
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

/** Everything a given agent has done, read from the live audit log. */
function AgentActivitySheet({
  agent,
  onOpenChange,
}: {
  agent: AdminAgent | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { auditLog } = useAdminStore();
  const entries = agent
    ? auditLog.filter((entry) => entry.actorId === agent.id)
    : [];

  return (
    <Sheet open={agent !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle>{agent ? `${agent.name}'s activity` : "Activity"}</SheetTitle>
          <SheetDescription>
            Every administrative action this operator has taken, newest first.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <AuditLogTable entries={entries} pageSize={8} />
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" block onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
