"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Coins, TrendingUp } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
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
import {
  FilterBar,
  FilterChips,
  FilterSelect,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { EmptyState } from "@/components/shared/empty-state";
import { RiskNote } from "@/components/shared/notices";
import { Progress } from "@/components/ui/progress";
import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import { adminInvestments } from "@/data/admin/investments";
import { adminPlans } from "@/data/admin/plans";
import { formatUsdt } from "@/lib/currency";
import type { AdminInvestment, AdminInvestmentStatus } from "@/types/admin";
import { formatDate, progressPercent } from "@/utils/format";

/**
 * Every allocation on the platform.
 *
 * Profit is shown as accrued-to-date next to the projection, and the risk
 * notice stays adjacent — the same language discipline the user application
 * follows applies here, because these are the same figures an operator would
 * quote back to a user.
 */

type StatusFilter = "all" | AdminInvestmentStatus;

export function InvestmentsView() {
  return (
    <>
      <AdminHeader
        title="Investments"
        description="Every allocation across all plans and users."
      />
      <AdminPage>
        <PermissionGate permission="investments">
          <InvestmentsBrowser />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function InvestmentsBrowser() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [plan, setPlan] = useState<string>("all");

  const statusOptions: FilterOption<StatusFilter>[] = useMemo(() => {
    const count = (value: AdminInvestmentStatus) =>
      adminInvestments.filter((row) => row.status === value).length;
    return [
      { value: "all", label: "All", count: adminInvestments.length },
      { value: "active", label: "Active", count: count("active") },
      { value: "matured", label: "Matured", count: count("matured") },
      { value: "cancelled", label: "Cancelled", count: count("cancelled") },
    ];
  }, []);

  const planOptions: FilterOption<string>[] = useMemo(
    () => [
      { value: "all", label: "All plans" },
      ...adminPlans.map((entry) => ({
        value: entry.id,
        label: entry.name,
        count: adminInvestments.filter((row) => row.planId === entry.id).length,
      })),
    ],
    [],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return adminInvestments
      .filter((row) => {
        if (status !== "all" && row.status !== status) return false;
        if (plan !== "all" && row.planId !== plan) return false;
        if (!needle) return true;
        return [row.id, row.userName, row.userDisplayId, row.planName]
          .join(" ")
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }, [query, status, plan]);

  const active = adminInvestments.filter((row) => row.status === "active");
  const allocated = active.reduce((sum, row) => sum + row.amountUsdt, 0);
  const accrued = adminInvestments.reduce((sum, row) => sum + row.profitUsdt, 0);

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
          value={active.length}
          icon={TrendingUp}
          hint={`${adminInvestments.length} in total, all time`}
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

      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search investments"
          placeholder="Investment ID, user or plan name"
        />
        <FilterSelect
          options={planOptions}
          value={plan}
          onChange={setPlan}
          label="Plan"
        />
      </FilterBar>

      <FilterChips
        options={statusOptions}
        value={status}
        onChange={setStatus}
        label="Filter by allocation status"
      />

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(row) => row.id}
        caption="Platform allocations with amount, accrued profit, term and status"
        pageSize={ADMIN_PAGE_SIZE}
        resetKey={`${query}|${status}|${plan}`}
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

      <RiskNote>
        Projected profit figures are estimates from the prototype investment
        model. They are never guaranteed and must not be presented to users as
        such.
      </RiskNote>
    </AdminSection>
  );
}
