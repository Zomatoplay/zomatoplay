"use client";

import { useState } from "react";
import { BadgeCheck, ChevronLeft } from "lucide-react";

import { KycCasePanel } from "@/components/admin/kyc/kyc-case-panel";
import { AdminSection } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import type { FilterOption } from "@/components/admin/shared/filter-bar";
import {
  AdminListBody,
  AdminListControls,
  AdminListPager,
  useAdminListNavigation,
} from "@/components/admin/shared/admin-list-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import type {
  AdminListPage,
  AdminListQuery,
  KycSubmission,
} from "@/types/admin";
import { formatDate } from "@/utils/format";

/**
 * KYC review queue.
 *
 * Selecting a case opens it in place rather than navigating away, so a reviewer
 * working through the queue keeps their filters and position.
 */

const SPEC = ADMIN_LIST_SPECS.kyc;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  pending: "Pending",
  under_review: "Under review",
  resubmission_requested: "Resubmission",
  approved: "Approved",
  rejected: "Rejected",
};

const SORT_OPTIONS: FilterOption<string>[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

export function KycQueue({
  page,
  query,
}: {
  page: AdminListPage<KycSubmission>;
  query: AdminListQuery;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const nav = useAdminListNavigation(query, SPEC);
  const { result, statusCounts } = page;
  const kyc = result.rows;

  const options: FilterOption<string>[] = SPEC.statuses.map((value) => ({
    value,
    label: STATUS_LABELS[value] ?? value,
    count: statusCounts[value] ?? 0,
  }));

  const selected = selectedId
    ? kyc.find((submission) => submission.id === selectedId)
    : null;

  if (selected) {
    return (
      <AdminSection className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
          <ChevronLeft className="size-4" />
          Back to the queue
        </Button>
        <KycCasePanel submission={selected} />
      </AdminSection>
    );
  }

  const columns: DataTableColumn<KycSubmission>[] = [
    {
      id: "user",
      header: "User",
      cell: (submission) => (
        <PrimaryCell
          title={submission.userName}
          subtitle={submission.userDisplayId}
        />
      ),
    },
    {
      id: "case",
      header: "Case",
      hideBelow: "lg",
      cell: (submission) => (
        <span className="tabular text-xs text-muted-foreground">
          {submission.id}
        </span>
      ),
    },
    {
      id: "submitted",
      header: "Submitted",
      numeric: true,
      cell: (submission) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(submission.submittedAt)}
        </span>
      ),
    },
    {
      id: "document",
      header: "Document",
      hideBelow: "lg",
      cell: (submission) => (
        <span className="text-sm capitalize text-muted-foreground">
          {submission.details.documentType.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      id: "flags",
      header: "Flags",
      hideBelow: "xl",
      cell: (submission) =>
        submission.riskFlags.length === 0 ? (
          <span className="text-xs text-muted-foreground">None</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {submission.riskFlags.map((flag) => (
              <Badge key={flag} variant="warning">
                {flag}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      id: "reviewer",
      header: "Reviewer",
      hideBelow: "xl",
      cell: (submission) => (
        <span className="text-sm text-muted-foreground">
          {submission.reviewedBy ?? "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (submission) => (
        <AdminStatusBadge kind="kyc" status={submission.status} />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      srOnlyHeader: true,
      numeric: true,
      cell: (submission) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelectedId(submission.id)}
        >
          Review
        </Button>
      ),
    },
  ];

  return (
    <AdminSection className="space-y-4">
      <AdminListControls
        nav={nav}
        query={query}
        spec={SPEC}
        searchLabel="Search KYC submissions"
        searchPlaceholder="User name, member ID, case ID or legal name"
        statusOptions={options}
        sortOptions={SORT_OPTIONS}
        statusLabel="Filter by review status"
      />

      <AdminListBody nav={nav}>
        <DataTable
          rows={kyc}
          columns={columns}
          getRowKey={(submission) => submission.id}
          caption="Identity verification submissions awaiting or holding a decision"
          empty={
            <EmptyState
              icon={BadgeCheck}
              title="Nothing in this queue"
              description="No verification submission matches the current filters."
            />
          }
          renderCard={(submission) => (
            <DataCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {submission.userName}
                  </p>
                  <p className="tabular truncate text-xs text-muted-foreground">
                    {submission.userDisplayId} · {submission.id}
                  </p>
                </div>
                <AdminStatusBadge kind="kyc" status={submission.status} />
              </div>
              <DataCardRow label="Submitted">
                <span className="tabular font-normal text-muted-foreground">
                  {formatDate(submission.submittedAt)}
                </span>
              </DataCardRow>
              <DataCardRow label="Document">
                <span className="capitalize">
                  {submission.details.documentType.replace(/_/g, " ")}
                </span>
              </DataCardRow>
              {submission.riskFlags.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {submission.riskFlags.map((flag) => (
                    <Badge key={flag} variant="warning">
                      {flag}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                block
                onClick={() => setSelectedId(submission.id)}
              >
                Review case
              </Button>
            </DataCard>
          )}
        />
      </AdminListBody>

      <AdminListPager nav={nav} result={result} label="cases" />
    </AdminSection>
  );
}
