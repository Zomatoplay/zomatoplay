"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, ChevronLeft } from "lucide-react";

import { KycCasePanel } from "@/components/admin/kyc/kyc-case-panel";
import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import {
  FilterBar,
  FilterChips,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import { useAdminStore } from "@/lib/admin-store";
import type { KycReviewStatus, KycSubmission } from "@/types/admin";
import { formatDate } from "@/utils/format";

/**
 * KYC review queue.
 *
 * Selecting a case opens it in place rather than navigating away, so a reviewer
 * working through the queue keeps their filters and position.
 */

type StatusFilter = "all" | KycReviewStatus;

export function KycView() {
  return (
    <>
      <AdminHeader
        title="KYC"
        description="Review identity verification submissions and record decisions."
      />
      <AdminPage>
        <PermissionGate permission="kyc">
          <KycQueue />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function KycQueue() {
  const { kyc } = useAdminStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const options: FilterOption<StatusFilter>[] = useMemo(() => {
    const count = (value: KycReviewStatus) =>
      kyc.filter((submission) => submission.status === value).length;
    return [
      { value: "all", label: "All", count: kyc.length },
      { value: "pending", label: "Pending", count: count("pending") },
      {
        value: "under_review",
        label: "Under review",
        count: count("under_review"),
      },
      {
        value: "resubmission_requested",
        label: "Resubmission",
        count: count("resubmission_requested"),
      },
      { value: "approved", label: "Approved", count: count("approved") },
      { value: "rejected", label: "Rejected", count: count("rejected") },
    ];
  }, [kyc]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return kyc
      .filter((submission) => {
        if (status !== "all" && submission.status !== status) return false;
        if (!needle) return true;
        return [
          submission.userName,
          submission.userDisplayId,
          submission.id,
          submission.details.legalName,
        ]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  }, [kyc, query, status]);

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
      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search KYC submissions"
          placeholder="User name, member ID, case ID or legal name"
        />
      </FilterBar>

      <FilterChips
        options={options}
        value={status}
        onChange={setStatus}
        label="Filter by review status"
      />

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(submission) => submission.id}
        caption="Identity verification submissions awaiting or holding a decision"
        pageSize={ADMIN_PAGE_SIZE}
        resetKey={`${query}|${status}`}
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
    </AdminSection>
  );
}
