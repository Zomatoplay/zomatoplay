"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { UsersRound } from "lucide-react";

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
  ClearFiltersButton,
  FilterBar,
  FilterChips,
  FilterSelect,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { UserActionMenu } from "@/components/admin/shared/user-action-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { RateNote } from "@/components/shared/notices";
import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { useAdminStore } from "@/lib/admin-store";
import type { AdminUser } from "@/types/admin";
import { formatDate } from "@/utils/format";

/**
 * User directory.
 *
 * Search covers every identifier a support agent is likely to be given on a
 * call — name, email, member id, phone, wallet address or referral code — since
 * which one the caller has to hand is not predictable.
 */

type StatusFilter =
  | "all"
  | "active"
  | "inactive"
  | "blocked"
  | "suspended"
  | "deactivated";

type KycFilter = "all" | "pending" | "approved" | "rejected";

/** Fields the search box matches against. */
function searchIndex(user: AdminUser) {
  return [
    user.fullName,
    user.email,
    user.id,
    user.displayId,
    user.phone,
    user.walletAddress,
    user.referralCode,
  ]
    .join(" ")
    .toLowerCase();
}

function matchesKyc(user: AdminUser, filter: KycFilter) {
  switch (filter) {
    case "all":
      return true;
    case "approved":
      return user.kycStatus === "verified";
    case "rejected":
      return user.kycStatus === "rejected";
    case "pending":
      return (
        user.kycStatus === "pending_review" ||
        user.kycStatus === "in_progress" ||
        user.kycStatus === "not_started"
      );
  }
}

/** The reviewer's status vocabulary, derived from the user's KYC state. */
function reviewStatus(user: AdminUser) {
  switch (user.kycStatus) {
    case "verified":
      return "approved" as const;
    case "rejected":
      return "rejected" as const;
    case "pending_review":
      return "pending" as const;
    default:
      return "under_review" as const;
  }
}

export function UsersView() {
  return (
    <>
      <AdminHeader
        title="Users"
        description="Search, filter and administer every account on the platform."
      />
      <AdminPage>
        <PermissionGate permission="users">
          <UsersBrowser />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function UsersBrowser() {
  const { users } = useAdminStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kyc, setKyc] = useState<KycFilter>("all");

  const statusOptions: FilterOption<StatusFilter>[] = useMemo(
    () => [
      { value: "all", label: "All", count: users.length },
      {
        value: "active",
        label: "Active",
        count: users.filter((u) => u.status === "active").length,
      },
      {
        value: "inactive",
        label: "Inactive",
        count: users.filter((u) => u.status === "inactive").length,
      },
      {
        value: "blocked",
        label: "Blocked",
        count: users.filter((u) => u.status === "blocked").length,
      },
      {
        value: "suspended",
        label: "Suspended",
        count: users.filter((u) => u.status === "suspended").length,
      },
      {
        value: "deactivated",
        label: "Deactivated",
        count: users.filter((u) => u.status === "deactivated").length,
      },
    ],
    [users],
  );

  const kycOptions: FilterOption<KycFilter>[] = useMemo(
    () => [
      { value: "all", label: "Any KYC status" },
      {
        value: "pending",
        label: "KYC pending",
        count: users.filter((u) => matchesKyc(u, "pending")).length,
      },
      {
        value: "approved",
        label: "KYC approved",
        count: users.filter((u) => matchesKyc(u, "approved")).length,
      },
      {
        value: "rejected",
        label: "KYC rejected",
        count: users.filter((u) => matchesKyc(u, "rejected")).length,
      },
    ],
    [users],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return users.filter((user) => {
      if (status !== "all" && user.status !== status) return false;
      if (!matchesKyc(user, kyc)) return false;
      if (needle && !searchIndex(user).includes(needle)) return false;
      return true;
    });
  }, [users, query, status, kyc]);

  const hasFilters = query !== "" || status !== "all" || kyc !== "all";

  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: "user",
      header: "User",
      cell: (user) => (
        <Link
          href={`/admin/users/${user.id}`}
          className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <PrimaryCell title={user.fullName} subtitle={user.displayId} />
        </Link>
      ),
    },
    {
      id: "email",
      header: "Email",
      hideBelow: "lg",
      cell: (user) => (
        <span className="block max-w-[16rem] truncate text-sm text-muted-foreground">
          {user.email}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (user) => <AdminStatusBadge kind="user" status={user.status} />,
    },
    {
      id: "kyc",
      header: "KYC",
      cell: (user) => (
        <AdminStatusBadge kind="kyc" status={reviewStatus(user)} />
      ),
    },
    {
      id: "balance",
      header: "Balance",
      numeric: true,
      cell: (user) => (
        <span className="flex flex-col items-end">
          <span className="font-medium">
            {formatUsdt(user.totals.availableUsdt, { withSymbol: false })}
          </span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {formatUsdtAsInr(user.totals.availableUsdt)}
          </span>
        </span>
      ),
    },
    {
      id: "deposited",
      header: "Deposited",
      numeric: true,
      hideBelow: "xl",
      cell: (user) => formatUsdt(user.totals.totalDeposited, { withSymbol: false }),
    },
    {
      id: "invested",
      header: "Invested",
      numeric: true,
      hideBelow: "lg",
      cell: (user) => formatUsdt(user.totals.totalInvested, { withSymbol: false }),
    },
    {
      id: "profit",
      header: "Profit",
      numeric: true,
      hideBelow: "xl",
      cell: (user) => (
        <span className={user.totals.totalProfit > 0 ? "text-positive" : undefined}>
          {formatUsdt(user.totals.totalProfit, { withSymbol: false })}
        </span>
      ),
    },
    {
      id: "withdrawn",
      header: "Withdrawn",
      numeric: true,
      hideBelow: "xl",
      cell: (user) => formatUsdt(user.totals.totalWithdrawn, { withSymbol: false }),
    },
    {
      id: "vip",
      header: "VIP",
      hideBelow: "lg",
      cell: (user) => (
        <span className="whitespace-nowrap text-sm uppercase">
          {user.vipLevel.replace("vip", "VIP ")}
        </span>
      ),
    },
    {
      id: "referrals",
      header: "Referrals",
      numeric: true,
      hideBelow: "xl",
      cell: (user) => user.referralCount,
    },
    {
      id: "registered",
      header: "Registered",
      numeric: true,
      hideBelow: "lg",
      cell: (user) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(user.registeredAt)}
        </span>
      ),
    },
    {
      id: "lastActive",
      header: "Last active",
      numeric: true,
      hideBelow: "xl",
      cell: (user) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(user.lastActiveAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      srOnlyHeader: true,
      numeric: true,
      width: "w-12",
      cell: (user) => <UserActionMenu user={user} editHref={`/admin/users/${user.id}`} />,
    },
  ];

  return (
    <AdminSection className="space-y-4">
      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search users"
          placeholder="Name, email, user ID, phone, wallet address or referral code"
        />
        <FilterSelect
          options={kycOptions}
          value={kyc}
          onChange={setKyc}
          label="KYC"
        />
        <ClearFiltersButton
          disabled={!hasFilters}
          onClear={() => {
            setQuery("");
            setStatus("all");
            setKyc("all");
          }}
        />
      </FilterBar>

      <FilterChips
        options={statusOptions}
        value={status}
        onChange={setStatus}
        label="Filter by account status"
      />

      <DataTable
        rows={filtered}
        columns={columns}
        getRowKey={(user) => user.id}
        caption="Platform users with balances, verification state and activity"
        pageSize={ADMIN_PAGE_SIZE}
        resetKey={`${query}|${status}|${kyc}`}
        empty={
          <EmptyState
            icon={UsersRound}
            title="No matching users"
            description="No account matches this search and filter combination."
          />
        }
        renderCard={(user) => (
          <DataCard>
            <div className="flex items-start justify-between gap-3">
              <Link
                href={`/admin/users/${user.id}`}
                className="min-w-0 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <p className="truncate text-sm font-medium text-brand">
                  {user.fullName}
                </p>
                <p className="tabular truncate text-xs text-muted-foreground">
                  {user.displayId}
                </p>
              </Link>
              <UserActionMenu user={user} editHref={`/admin/users/${user.id}`} />
            </div>

            <div className="flex flex-wrap gap-1.5">
              <AdminStatusBadge kind="user" status={user.status} />
              <AdminStatusBadge kind="kyc" status={reviewStatus(user)} />
            </div>

            <DataCardRow label="Email">
              <span className="break-all font-normal text-muted-foreground">
                {user.email}
              </span>
            </DataCardRow>
            <DataCardRow label="Balance">
              <span className="tabular block">
                {formatUsdt(user.totals.availableUsdt)}
              </span>
              <span className="tabular block text-xs font-normal text-muted-foreground">
                {formatUsdtAsInr(user.totals.availableUsdt)}
              </span>
            </DataCardRow>
            <DataCardRow label="Invested">
              <span className="tabular">
                {formatUsdt(user.totals.totalInvested)}
              </span>
            </DataCardRow>
            <DataCardRow label="Profit">
              <span className="tabular text-positive">
                {formatUsdt(user.totals.totalProfit)}
              </span>
            </DataCardRow>
            <DataCardRow label="Registered">
              <span className="tabular font-normal text-muted-foreground">
                {formatDate(user.registeredAt)}
              </span>
            </DataCardRow>
          </DataCard>
        )}
      />

      <RateNote />
    </AdminSection>
  );
}
