"use client";

import Link from "next/link";
import { ScrollText } from "lucide-react";

import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { auditActionLabels } from "@/data/admin/audit-logs";
import { cn } from "@/lib/utils";
import type { AuditLogEntry } from "@/types/admin";
import { formatDateTime } from "@/utils/format";

/**
 * Renders the administrative audit trail.
 *
 * Read-only by design: there is no edit or delete affordance anywhere, because
 * an audit log that an operator can rewrite is not an audit log.
 */

/** Links the affected record back to the screen it lives on, where one exists. */
function targetHref(target: AuditLogEntry["target"]): string | null {
  if (!target) return null;
  switch (target.type) {
    case "user":
      return `/admin/users/${target.id}`;
    case "agent":
      return "/admin/agents";
    case "plan":
      return "/admin/plans";
    case "deposit":
      return "/admin/deposits";
    case "withdrawal":
      return "/admin/withdrawals";
    case "kyc":
      return "/admin/kyc";
    case "notification":
      return "/admin/notifications";
    case "settings":
      return "/admin/settings";
  }
}

function TargetLink({ target }: { target: AuditLogEntry["target"] }) {
  if (!target) return <span className="text-muted-foreground">—</span>;
  const href = targetHref(target);
  if (!href) return <span>{target.label}</span>;
  return (
    <Link
      href={href}
      className="rounded text-brand transition-colors hover:text-brand/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {target.label}
    </Link>
  );
}

export function AuditLogTable({
  entries,
  resetKey,
  pageSize = 12,
  className,
}: {
  entries: AuditLogEntry[];
  resetKey?: string;
  pageSize?: number;
  className?: string;
}) {
  const columns: DataTableColumn<AuditLogEntry>[] = [
    {
      id: "action",
      header: "Action",
      cell: (entry) => (
        <PrimaryCell
          title={auditActionLabels[entry.action]}
          subtitle={entry.id}
        />
      ),
    },
    {
      id: "actor",
      header: "Performed by",
      cell: (entry) => (
        <PrimaryCell
          title={entry.actorName}
          subtitle={entry.actorRole === "master_admin" ? "Master admin" : "Agent"}
        />
      ),
    },
    {
      id: "target",
      header: "Affected",
      cell: (entry) => (
        <span className="block max-w-[16rem] truncate text-sm">
          <TargetLink target={entry.target} />
        </span>
      ),
    },
    {
      id: "details",
      header: "Details",
      hideBelow: "xl",
      cell: (entry) => (
        <span className="block max-w-[26rem] text-xs leading-relaxed text-muted-foreground">
          {entry.details}
        </span>
      ),
    },
    {
      id: "ip",
      header: "IP",
      hideBelow: "xl",
      numeric: true,
      cell: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">
          {entry.ipAddress}
        </span>
      ),
    },
    {
      id: "when",
      header: "When",
      numeric: true,
      hideBelow: "lg",
      cell: (entry) => (
        <time dateTime={entry.createdAt} className="text-xs text-muted-foreground">
          {formatDateTime(entry.createdAt)}
        </time>
      ),
    },
    {
      id: "outcome",
      header: "Outcome",
      cell: (entry) => (
        <AdminStatusBadge kind="outcome" status={entry.outcome} />
      ),
    },
  ];

  return (
    <DataTable
      className={cn(className)}
      rows={entries}
      columns={columns}
      getRowKey={(entry) => entry.id}
      caption="Administrative actions, most recent first"
      pageSize={pageSize}
      resetKey={resetKey}
      empty={
        <EmptyState
          icon={ScrollText}
          title="No matching audit entries"
          description="Adjust the filters to widen the search."
        />
      }
      renderCard={(entry) => (
        <DataCard>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {auditActionLabels[entry.action]}
              </p>
              <p className="tabular text-xs text-muted-foreground">{entry.id}</p>
            </div>
            <AdminStatusBadge kind="outcome" status={entry.outcome} />
          </div>
          <DataCardRow label="By">{entry.actorName}</DataCardRow>
          <DataCardRow label="Affected">
            <TargetLink target={entry.target} />
          </DataCardRow>
          <DataCardRow label="When">
            <time dateTime={entry.createdAt} className="tabular">
              {formatDateTime(entry.createdAt)}
            </time>
          </DataCardRow>
          <p className="border-t border-border pt-2.5 text-xs leading-relaxed text-muted-foreground">
            {entry.details}
          </p>
        </DataCard>
      )}
    />
  );
}
