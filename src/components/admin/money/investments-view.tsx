"use client";


import Link from "next/link";
import { Coins, TrendingUp } from "lucide-react";

import { AdminSection } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import {
  AdminStatCard,
  AdminStatGrid,
} from "@/components/admin/shared/admin-stat-card";
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
import { RiskNote } from "@/components/shared/notices";
import { Progress } from "@/components/ui/progress";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import { formatUsdt } from "@/lib/currency";
import type {
  AdminInvestment,
  AdminInvestmentsSummary,
  AdminListPage,
  AdminListQuery,
  AdminPlan,
} from "@/types/admin";
import { formatDate, progressPercent } from "@/utils/format";

/**
 * Every allocation on the platform.
 *
 * Profit is shown as accrued-to-date next to the projection, and the risk
 * notice stays adjacent — the same language discipline the user application
 * follows applies here, because these are the same figures an operator would
 * quote back to a user.
 */

const SPEC = ADMIN_LIST_SPECS.investments;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  active: "Active",
  matured: "Matured",
  cancelled: "Cancelled",
};

const SORT_OPTIONS: FilterOption<string>[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount", label: "Largest amount" },
];

export function InvestmentsBrowser({
  page,
  query,
  plans,
}: {
  page: AdminListPage<AdminInvestment> & { summary: AdminInvestmentsSummary };
  query: AdminListQuery;
  plans: AdminPlan[];
}) {
  const nav = useAdminListNavigation(query, SPEC);
  const { result, statusCounts, summary } = page;
  const investments = result.rows;

  const statusOptions: FilterOption<string>[] = SPEC.statuses.map((value) => ({
    value,
    label: STATUS_LABELS[value] ?? value,
    count: statusCounts[value] ?? 0,
  }));

  /*
   * The plan filter is the screen's second dimension, and its options come
   * from the plan catalogue rather than from the rows — a plan with no
   * allocations must still be selectable, or an operator cannot confirm that
   * it has none. The per-plan counts are gone with the client-side array;
   * counting them would be a `GROUP BY plan_id` per render for a number
   * nobody triages by.
   */
  const planOptions: FilterOption<string>[] = [
    { value: "all", label: "All plans" },
    ...plans.map((entry) => ({ value: entry.id, label: entry.name })),
  ];

  const active = summary.activeCount;
  const allocated = summary.allocatedUsdt;
  const accrued = summary.accruedProfitUsdt;

  const columns: DataTableColumn<AdminInvestment>[] = [
    {
      id: "id",
      header: "Investment",
      cell: (row) => <PrimaryCell title={row.id} subtitle={row.planName} />,
    },
    {
      id: "user",
      header: "User",
      cell: (row) => (
        <Link
          href={`/admin/users/${row.userId}`}
          className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <PrimaryCell title={row.userName} subtitle={row.userDisplayId} />
        </Link>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      numeric: true,
      cell: (row) => formatUsdt(row.amountUsdt, { withSymbol: false }),
    },
    {
      id: "profit",
      header: "Profit accrued",
      numeric: true,
      cell: (row) => (
        <span className="flex flex-col items-end">
          <span className="text-positive">
            {formatUsdt(row.profitUsdt, { withSymbol: false })}
          </span>
          <span className="text-xs text-muted-foreground">
            of {formatUsdt(row.projectedProfitUsdt, { withSymbol: false })} est.
          </span>
        </span>
      ),
    },
    {
      id: "started",
      header: "Started",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.startedAt)}
        </span>
      ),
    },
    {
      id: "matures",
      header: "Matures",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.durationDays === 0 ? "No lock-in" : formatDate(row.maturesAt)}
        </span>
      ),
    },
    {
      id: "term",
      header: "Progress",
      hideBelow: "xl",
      cell: (row) => (
        <span className="flex min-w-28 flex-col gap-1">
          <span className="tabular text-xs text-muted-foreground">
            {row.durationDays === 0
              ? `${row.elapsedDays} days open`
              : `${row.elapsedDays} / ${row.durationDays} days`}
          </span>
          {row.durationDays > 0 ? (
            <Progress
              value={progressPercent(row.elapsedDays, row.durationDays)}
              className="h-1"
            />
          ) : null}
        </span>
      ),
    },
    {
      id: "next",
      header: "Next reward",
      numeric: true,
      hideBelow: "xl",
      cell: (row) =>
        row.nextRewardAt ? (
          <span className="flex flex-col items-end">
            <span className="text-xs text-muted-foreground">
              {formatDate(row.nextRewardAt)}
            </span>
            {row.nextRewardAmount !== null ? (
              <span className="text-xs">
                {formatUsdt(row.nextRewardAmount, { withSymbol: false })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <AdminStatusBadge kind="investment" status={row.status} />,
    },
  ];

  return (
    <AdminSection className="space-y-4">
      <AdminStatGrid className="md:grid-cols-3 xl:grid-cols-3">
        <AdminStatCard
          label="Active allocations"
          value={active}
          icon={TrendingUp}
          hint={`${summary.totalCount} in total, all time`}
        />
        <AdminStatCard
          label="Capital allocated"
          amount={allocated}
          icon={Coins}
          hint="Across active allocations"
          showInr
        />
        <AdminStatCard
          label="Profit accrued"
          amount={accrued}
          tone="positive"
          hint="Credited and accruing — an estimate, not a guarantee"
          showInr
        />
      </AdminStatGrid>

      <AdminListControls
        nav={nav}
        query={query}
        spec={SPEC}
        searchLabel="Search investments"
        searchPlaceholder="Investment ID, user or plan name"
        statusOptions={statusOptions}
        filterOptions={planOptions}
        filterLabel="Plan"
        sortOptions={SORT_OPTIONS}
        statusLabel="Filter by allocation status"
      />

      <AdminListBody nav={nav}>
        <DataTable
          rows={investments}
          columns={columns}
          getRowKey={(row) => row.id}
          caption="Platform allocations with amount, accrued profit, term and status"
          empty={
            <EmptyState
              icon={TrendingUp}
              title="No matching investments"
              description="No allocation matches the current search and filters."
            />
          }
          renderCard={(row) => (
            <DataCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="tabular text-sm font-medium">{row.id}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {row.planName}
                  </p>
                </div>
                <AdminStatusBadge kind="investment" status={row.status} />
              </div>
              <DataCardRow label="User">
                <Link href={`/admin/users/${row.userId}`} className="text-brand">
                  {row.userName}
                </Link>
              </DataCardRow>
              <DataCardRow label="Amount">
                <span className="tabular">{formatUsdt(row.amountUsdt)}</span>
              </DataCardRow>
              <DataCardRow label="Profit accrued">
                <span className="tabular text-positive">
                  {formatUsdt(row.profitUsdt)}
                </span>
              </DataCardRow>
              <DataCardRow label="Term">
                <span className="tabular font-normal text-muted-foreground">
                  {row.durationDays === 0
                    ? "No lock-in"
                    : `${row.elapsedDays} / ${row.durationDays} days`}
                </span>
              </DataCardRow>
              <DataCardRow label="Next reward">
                <span className="tabular font-normal text-muted-foreground">
                  {row.nextRewardAt ? formatDate(row.nextRewardAt) : "—"}
                </span>
              </DataCardRow>
            </DataCard>
          )}
        />
      </AdminListBody>

      <AdminListPager nav={nav} result={result} label="allocations" />

      <RiskNote>
        Projected profit figures are estimates from the investment
        model. They are never guaranteed and must not be presented to users as
        such.
      </RiskNote>
    </AdminSection>
  );
}
