"use client";

import { useMemo, useState } from "react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import { AuditLogTable } from "@/components/admin/shared/audit-log-table";
import {
  AdminStatCard,
  AdminStatGrid,
} from "@/components/admin/shared/admin-stat-card";
import {
  ClearFiltersButton,
  FilterBar,
  FilterChips,
  FilterSelect,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { PrototypeNote } from "@/components/shared/notices";
import { auditActionGroups, auditActionLabels } from "@/data/admin/audit-logs";
import { useAdminStore } from "@/lib/admin-store";
import type { AuditAction } from "@/types/admin";

/**
 * The administrative audit trail.
 *
 * Read-only. Actions taken elsewhere in this session appear here immediately,
 * because every mutating reducer case writes its audit entry in the same
 * transaction as the change itself.
 */

type GroupFilter = "all" | string;
type ActorFilter = "all" | string;
type OutcomeFilter = "all" | "success" | "failed";

export function AuditLogsView() {
  return (
    <>
      <AdminHeader
        title="Audit logs"
        description="Every administrative action, who took it and what changed."
      />
      <AdminPage>
        <PermissionGate permission="audit_logs">
          <AuditLogBrowser />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function AuditLogBrowser() {
  const { auditLog, agents } = useAdminStore();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<GroupFilter>("all");
  const [actor, setActor] = useState<ActorFilter>("all");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");

  /** Which actions belong to the selected group. */
  const groupActions = useMemo<Set<AuditAction> | null>(() => {
    if (group === "all") return null;
    const found = auditActionGroups.find((entry) => entry.label === group);
    return found ? new Set(found.actions) : null;
  }, [group]);

  const groupOptions: FilterOption<GroupFilter>[] = useMemo(
    () => [
      { value: "all", label: "All", count: auditLog.length },
      ...auditActionGroups.map((entry) => ({
        value: entry.label,
        label: entry.label,
        count: auditLog.filter((log) => entry.actions.includes(log.action))
          .length,
      })),
    ],
    [auditLog],
  );

  const actorOptions: FilterOption<ActorFilter>[] = useMemo(
    () => [
      { value: "all", label: "Anyone" },
      ...agents.map((agent) => ({
        value: agent.id,
        label: agent.name,
        count: auditLog.filter((log) => log.actorId === agent.id).length,
      })),
    ],
    [agents, auditLog],
  );

  const outcomeOptions: FilterOption<OutcomeFilter>[] = [
    { value: "all", label: "Any outcome" },
    { value: "success", label: "Succeeded" },
    { value: "failed", label: "Blocked" },
  ];

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return auditLog.filter((entry) => {
      if (groupActions && !groupActions.has(entry.action)) return false;
      if (actor !== "all" && entry.actorId !== actor) return false;
      if (outcome !== "all" && entry.outcome !== outcome) return false;
      if (!needle) return true;
      return [
        entry.id,
        entry.actorName,
        auditActionLabels[entry.action],
        entry.target?.label ?? "",
        entry.details,
        entry.ipAddress,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [auditLog, query, groupActions, actor, outcome]);

  const hasFilters =
    query !== "" || group !== "all" || actor !== "all" || outcome !== "all";

  const blocked = auditLog.filter((entry) => entry.outcome === "failed").length;
  const activeActors = new Set(auditLog.map((entry) => entry.actorId)).size;

  return (
    <AdminSection className="space-y-4">
      <PrototypeNote>
        Audit entries are append-only and cannot be edited or deleted from this
        interface. Actions you take elsewhere in this session appear here
        immediately.
      </PrototypeNote>

      <AdminStatGrid className="md:grid-cols-3 xl:grid-cols-3">
        <AdminStatCard label="Recorded actions" value={auditLog.length} />
        <AdminStatCard
          label="Operators represented"
          value={activeActors}
          hint="Distinct agents appearing in the log"
        />
        <AdminStatCard
          label="Blocked attempts"
          value={blocked}
          tone={blocked > 0 ? "negative" : "default"}
          hint="Actions refused by the permission model"
        />
      </AdminStatGrid>

      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search audit log"
          placeholder="Action, operator, affected record, details or IP address"
        />
        <FilterSelect
          options={actorOptions}
          value={actor}
          onChange={setActor}
          label="Operator"
        />
        <FilterSelect
          options={outcomeOptions}
          value={outcome}
          onChange={setOutcome}
          label="Outcome"
        />
        <ClearFiltersButton
          disabled={!hasFilters}
          onClear={() => {
            setQuery("");
            setGroup("all");
            setActor("all");
            setOutcome("all");
          }}
        />
      </FilterBar>

      <FilterChips
        options={groupOptions}
        value={group}
        onChange={setGroup}
        label="Filter by action category"
      />

      <AuditLogTable
        entries={filtered}
        resetKey={`${query}|${group}|${actor}|${outcome}`}
      />
    </AdminSection>
  );
}
