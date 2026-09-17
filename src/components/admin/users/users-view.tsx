"use client";

import Link from "next/link";
import { UsersRound } from "lucide-react";

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
import { UserActionMenu } from "@/components/admin/shared/user-action-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { RateNote } from "@/components/shared/notices";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import type { AdminListPage, AdminListQuery, AdminUser } from "@/types/admin";
import { formatDate } from "@/utils/format";

/**
 * User directory.
 *
 * Search covers every identifier a support agent is likely to be given on a
 * call — name, email, member id, phone, wallet address or referral code — since
 * which one the caller has to hand is not predictable.
 */

const SPEC = ADMIN_LIST_SPECS.users;

/** The status chips, in the order an operator triages them. */
const STATUS_LABELS: Record<string, string> = {
  all: "All",
  active: "Active",
  inactive: "Inactive",
  blocked: "Blocked",
  suspended: "Suspended",
  deactivated: "Deactivated",
};

const KYC_OPTIONS: FilterOption<string>[] = [
  { value: "all", label: "Any KYC status" },
  { value: "pending", label: "KYC pending" },
  { value: "approved", label: "KYC approved" },
  { value: "rejected", label: "KYC rejected" },
];

const SORT_OPTIONS: FilterOption<string>[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "name", label: "Name A-Z" },
  { value: "balance", label: "Largest balance" },
  { value: "active", label: "Recently active" },
];

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

/**
 * The directory.
 *
 * Every predicate here used to run in the browser over a complete copy of the
 * `users` table: the page fetched every account joined to every wallet, and
 * this component filtered, sorted and sliced it to ten. The search box, the
 * chips and the sort now write the URL and Postgres answers them — so what
 * crosses the wire is ten rows and six counts, whatever the platform grows to.
 *
 * What did not change is the vocabulary: the same statuses, the same KYC
 * groupings and the same searchable fields, moved rather than redesigned.
 */
export function UsersBrowser({
  page,
  query,
}: {
  page: AdminListPage<AdminUser>;
  query: AdminListQuery;
}) {
  const nav = useAdminListNavigation(query, SPEC);
  const { result, statusCounts } = page;

  const statusOptions: FilterOption<string>[] = SPEC.statuses.map((value) => ({
    value,
    label: STATUS_LABELS[value] ?? value,
    count: statusCounts[value] ?? 0,
  }));

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
      <AdminListControls
        nav={nav}
        query={query}
        spec={SPEC}
        searchLabel="Search users"
        searchPlaceholder="Name, email, user ID, phone, wallet address or referral code"
        statusOptions={statusOptions}
        filterOptions={KYC_OPTIONS}
        filterLabel="KYC"
        sortOptions={SORT_OPTIONS}
        statusLabel="Filter by account status"
      />

      <AdminListBody nav={nav}>
        <DataTable
          rows={result.rows}
          columns={columns}
          getRowKey={(user) => user.id}
          caption="Platform users with balances, verification state and activity"
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
      </AdminListBody>

      <AdminListPager nav={nav} result={result} label="users" />

      <RateNote />
    </AdminSection>
  );
}
