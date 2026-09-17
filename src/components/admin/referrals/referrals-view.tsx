"use client";

import { useState } from "react";
import Link from "next/link";
import { Gift, Users } from "lucide-react";

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
import { DetailCard } from "@/components/admin/shared/detail-list";
import type { FilterOption } from "@/components/admin/shared/filter-bar";
import {
  AdminListBody,
  AdminListControls,
  AdminListPager,
  useAdminListNavigation,
} from "@/components/admin/shared/admin-list-controls";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import { vipLevels } from "@/data/referrals";
import { Button } from "@/components/ui/button";
import { releaseCommissionAction } from "@/app/admin/actions";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore, useAdminSession } from "@/lib/admin-store";
import { formatUsdt } from "@/lib/currency";
import type {
  AdminCommissionEntry,
  AdminListPage,
  AdminListQuery,
  AdminReferralAccount,
  AdminReferralsSummary,
} from "@/types/admin";
import { formatDate } from "@/utils/format";
import { cn } from "@/lib/utils";
import { formatBusinessDateTime } from "@/lib/business-time";

/**
 * Referral programme administration.
 *
 * The VIP tiers rendered here are read from `@/data/referrals` — the same
 * module the user application reads. Percentages and qualifying thresholds are
 * never restated in this component, so a future config service changes both
 * applications by changing one file.
 */

const ACCOUNT_SPEC = ADMIN_LIST_SPECS.referralAccounts;
const COMMISSION_SPEC = ADMIN_LIST_SPECS.commissions;

/**
 * The two tables on this screen page independently.
 *
 * Every other list screen owns its URL outright. This one has an account
 * table and a commission ledger side by side, so each owns a prefix — `a` and
 * `c` — and the query builder passes the sibling's parameters through
 * untouched. Without that, paging the ledger would reset the accounts table
 * behind the other tab.
 */
const ACCOUNT_PREFIX = "a";
const COMMISSION_PREFIX = "c";

const ACCOUNT_SORTS: FilterOption<string>[] = [
  { value: "earnings", label: "Most commission" },
  { value: "referrals", label: "Most active referrals" },
  { value: "recent", label: "Newest" },
];

const COMMISSION_STATUS_LABELS: Record<string, string> = {
  all: "All",
  pending: "Pending",
  credited: "Credited",
  reversed: "Reversed",
};

const COMMISSION_SORTS: FilterOption<string>[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount", label: "Largest amount" },
];

export function ReferralsBrowser({
  accounts,
  commissions,
  accountQuery,
  commissionQuery,
  summary,
}: {
  accounts: AdminListPage<AdminReferralAccount>;
  commissions: AdminListPage<AdminCommissionEntry>;
  accountQuery: AdminListQuery;
  commissionQuery: AdminListQuery;
  summary: AdminReferralsSummary;
}) {
  const { settings } = useAdminStore();
  const session = useAdminSession();
  const { run, pending } = useAdminAction();
  /*
   * The entry awaiting confirmation, if any.
   *
   * Releasing commission moves real money into somebody's balance, so it takes
   * the same confirmation every other consequential action in this console
   * takes rather than firing on a single click.
   */
  const [releasing, setReleasing] = useState<AdminCommissionEntry | null>(null);
  const mayRelease = canManage(session, "referrals");

  const accountNav = useAdminListNavigation(
    accountQuery,
    ACCOUNT_SPEC,
    ACCOUNT_PREFIX,
  );
  const commissionNav = useAdminListNavigation(
    commissionQuery,
    COMMISSION_SPEC,
    COMMISSION_PREFIX,
  );

  const referralAccounts = accounts.result.rows;
  const commissionLedger = commissions.result.rows;

  const vipOptions: FilterOption<string>[] = [
    { value: "all", label: "All", count: accounts.statusCounts.all ?? 0 },
    ...vipLevels.map((level) => ({
      value: level.id,
      label: level.name,
      count: accounts.statusCounts[level.id] ?? 0,
    })),
  ];

  const commissionStatusOptions: FilterOption<string>[] =
    COMMISSION_SPEC.statuses.map((value) => ({
      value,
      label: COMMISSION_STATUS_LABELS[value] ?? value,
      count: commissions.statusCounts[value] ?? 0,
    }));

  // Platform-wide, from SQL — reducing the ten rows on screen would be a
  // different number, not a smaller one.
  const totalCommission = summary.creditedCommissionUsdt;
  const pendingCommission = summary.pendingCommissionUsdt;
  const totalTeamVolume = summary.totalTeamVolumeUsdt;

  const accountColumns: DataTableColumn<AdminReferralAccount>[] = [
    {
      id: "user",
      header: "Referrer",
      cell: (account) => (
        <Link
          href={`/admin/users/${account.userId}`}
          className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <PrimaryCell
            title={account.userName}
            subtitle={account.userDisplayId}
          />
        </Link>
      ),
    },
    {
      id: "code",
      header: "Referral code",
      cell: (account) => (
        <span className="tabular text-sm">{account.referralCode}</span>
      ),
    },
    {
      id: "vip",
      header: "VIP",
      cell: (account) => (
        <Badge variant="brand">
          {vipLevels.find((level) => level.id === account.vipLevel)?.name ??
            account.vipLevel}
        </Badge>
      ),
    },
    {
      id: "direct",
      header: "Tier 1",
      numeric: true,
      cell: (account) => account.directReferrals,
    },
    {
      id: "indirect",
      header: "Tier 2",
      numeric: true,
      hideBelow: "lg",
      cell: (account) => account.indirectReferrals,
    },
    {
      id: "active",
      header: "Active",
      numeric: true,
      hideBelow: "lg",
      cell: (account) => account.activeReferrals,
    },
    {
      id: "volume",
      header: "Team volume",
      numeric: true,
      cell: (account) =>
        formatUsdt(account.teamVolumeUsdt, { withSymbol: false, compact: true }),
    },
    {
      id: "earned",
      header: "Commission",
      numeric: true,
      cell: (account) => (
        <span className="text-positive">
          {formatUsdt(account.commissionEarnedUsdt, { withSymbol: false })}
        </span>
      ),
    },
    {
      id: "pending",
      header: "Pending",
      numeric: true,
      hideBelow: "xl",
      cell: (account) =>
        formatUsdt(account.commissionPendingUsdt, { withSymbol: false }),
    },
    {
      id: "joined",
      header: "Joined",
      numeric: true,
      hideBelow: "xl",
      cell: (account) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(account.joinedAt)}
        </span>
      ),
    },
  ];

  const commissionColumns: DataTableColumn<AdminCommissionEntry>[] = [
    {
      id: "id",
      header: "Entry",
      cell: (entry) => (
        <PrimaryCell title={entry.id} subtitle={formatDate(entry.createdAt)} />
      ),
    },
    {
      id: "beneficiary",
      header: "Paid to",
      cell: (entry) => (
        <Link
          href={`/admin/users/${entry.beneficiaryUserId}`}
          className="rounded text-sm text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {entry.beneficiaryName}
        </Link>
      ),
    },
    {
      id: "source",
      header: "Generated by",
      cell: (entry) => (
        <span className="text-sm text-muted-foreground">
          {entry.sourceUserName}
        </span>
      ),
    },
    {
      id: "tier",
      header: "Tier",
      numeric: true,
      cell: (entry) => `Tier ${entry.tier}`,
    },
    {
      id: "plan",
      header: "Source plan",
      hideBelow: "lg",
      cell: (entry) => (
        <span className="text-sm text-muted-foreground">
          {entry.sourcePlanName}
        </span>
      ),
    },
    {
      id: "amount",
      header: "Amount",
      numeric: true,
      cell: (entry) => (
        <span className="font-medium text-positive">
          {formatUsdt(entry.amountUsdt, { withSymbol: false })}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (entry) => (
        <AdminStatusBadge kind="commission" status={entry.status} />
      ),
    },
    {
      id: "schedule",
      header: "Release",
      hideBelow: "lg",
      cell: (entry) => <ReleaseCell entry={entry} />,
    },
    {
      id: "release",
      header: "Action",
      cell: (entry) =>
        entry.status === "pending" ? (
          /*
           * Disabled rather than hidden for an operator without `manage`.
           *
           * CLAUDE.md §15.3: a read-only operator should be able to see that
           * the capability exists and who to ask for it, rather than wondering
           * whether the screen is broken.
           */
          <Button
            variant="outline"
            size="xs"
            disabled={!mayRelease || pending}
            onClick={() => setReleasing(entry)}
          >
            Release
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <AdminSection className="space-y-4">
      <AdminStatGrid className="md:grid-cols-4 xl:grid-cols-4">
        <AdminStatCard
          label="Referral accounts"
          value={referralAccounts.length}
          icon={Users}
          hint="Users who have referred at least one person"
        />
        <AdminStatCard
          label="Team volume"
          amount={totalTeamVolume}
          hint="Total invested by referred users"
          showInr
        />
        <AdminStatCard
          label="Commission credited"
          amount={totalCommission}
          icon={Gift}
          tone="positive"
          showInr
        />
        <AdminStatCard
          label="Commission pending"
          amount={pendingCommission}
          tone={pendingCommission > 0 ? "warning" : "default"}
          hint={`Released automatically at 00:00 IST, ${settings.referrals.payoutDelayDays} day${
            settings.referrals.payoutDelayDays === 1 ? "" : "s"
          } after the allocation`}
        />
      </AdminStatGrid>

      <DetailCard
        title="VIP levels"
        description="Commission percentages and qualifying thresholds. Configured as data and shared with the user application."
      >
        <ul className="grid gap-3 md:grid-cols-3">
          {vipLevels.map((level) => (
            <li
              key={level.id}
              className="rounded-xl border border-border p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{level.name}</span>
                <Badge variant="outline">
                  {
                    referralAccounts.filter(
                      (account) => account.vipLevel === level.id,
                    ).length
                  }{" "}
                  users
                </Badge>
              </div>
              <dl className="mt-2.5 space-y-1.5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Tier 1 commission</dt>
                  <dd className="tabular font-medium">
                    {level.tier1CommissionPercent}%
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Tier 2 commission</dt>
                  <dd className="tabular font-medium">
                    {level.tier2CommissionPercent}%
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Active referrals</dt>
                  <dd className="tabular font-medium">
                    {level.requirements.activeReferrals}+
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Team volume</dt>
                  <dd className="tabular font-medium">
                    {formatUsdt(level.requirements.teamVolumeUsdt, {
                      withSymbol: false,
                      compact: true,
                    })}
                    +
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </DetailCard>

      <Tabs defaultValue="accounts">
        <TabsList>
          <TabsTrigger value="accounts">Referral accounts</TabsTrigger>
          <TabsTrigger value="commissions">Commission history</TabsTrigger>
        </TabsList>

        <TabsContent value="accounts" className="space-y-4">
          <AdminListControls
            nav={accountNav}
            query={accountQuery}
            spec={ACCOUNT_SPEC}
            searchLabel="Search referral accounts"
            searchPlaceholder="Referrer name, member ID or referral code"
            statusOptions={vipOptions}
            sortOptions={ACCOUNT_SORTS}
            statusLabel="Filter by VIP level"
          />
          <AdminListBody nav={accountNav}>
            <DataTable
              rows={referralAccounts}
              columns={accountColumns}
              getRowKey={(account) => account.userId}
              caption="Referral accounts ranked by commission earned"
              empty={
                <EmptyState
                  icon={Users}
                  title="No matching referral accounts"
                  description="No referrer matches the current search and filters."
                />
              }
              renderCard={(account) => (
                <DataCard>
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      href={`/admin/users/${account.userId}`}
                      className="min-w-0"
                    >
                      <p className="truncate text-sm font-medium text-brand">
                        {account.userName}
                      </p>
                      <p className="tabular truncate text-xs text-muted-foreground">
                        {account.referralCode}
                      </p>
                    </Link>
                    <Badge variant="brand">
                      {vipLevels.find((level) => level.id === account.vipLevel)
                        ?.name ?? account.vipLevel}
                    </Badge>
                  </div>
                  <DataCardRow label="Referrals">
                    <span className="tabular">
                      {account.directReferrals} tier 1 ·{" "}
                      {account.indirectReferrals} tier 2
                    </span>
                  </DataCardRow>
                  <DataCardRow label="Team volume">
                    <span className="tabular">
                      {formatUsdt(account.teamVolumeUsdt)}
                    </span>
                  </DataCardRow>
                  <DataCardRow label="Commission">
                    <span className="tabular text-positive">
                      {formatUsdt(account.commissionEarnedUsdt)}
                    </span>
                  </DataCardRow>
                </DataCard>
              )}
            />
          </AdminListBody>

          <AdminListPager nav={accountNav} result={accounts.result} label="accounts" />
        </TabsContent>

        <TabsContent value="commissions" className="space-y-4">
          <AdminListControls
            nav={commissionNav}
            query={commissionQuery}
            spec={COMMISSION_SPEC}
            searchLabel="Search commission entries"
            searchPlaceholder="Beneficiary name, member ID or referral code"
            statusOptions={commissionStatusOptions}
            sortOptions={COMMISSION_SORTS}
            statusLabel="Filter by commission status"
          />
          <AdminListBody nav={commissionNav}>
            <DataTable
              rows={commissionLedger}
              columns={commissionColumns}
              getRowKey={(entry) => entry.id}
              caption="Commission ledger entries"
              empty={
                <EmptyState
                  icon={Gift}
                  title="No matching commission entries"
                  description="No ledger entry matches this search."
                />
              }
              renderCard={(entry) => (
                <DataCard>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="tabular text-sm font-medium">{entry.id}</p>
                      <p className="tabular text-xs text-muted-foreground">
                        {formatDate(entry.createdAt)}
                      </p>
                    </div>
                    <AdminStatusBadge kind="commission" status={entry.status} />
                  </div>
                  <DataCardRow label="Paid to">
                    <Link
                      href={`/admin/users/${entry.beneficiaryUserId}`}
                      className="text-brand"
                    >
                      {entry.beneficiaryName}
                    </Link>
                  </DataCardRow>
                  <DataCardRow label="Generated by">
                    {entry.sourceUserName} · Tier {entry.tier}
                  </DataCardRow>
                  <DataCardRow label="Amount">
                    <span className="tabular text-positive">
                      {formatUsdt(entry.amountUsdt)}
                    </span>
                  </DataCardRow>
                  {entry.status === "pending" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      block
                      disabled={!mayRelease || pending}
                      onClick={() => setReleasing(entry)}
                    >
                      Release commission
                    </Button>
                  ) : null}
                </DataCard>
              )}
            />
          </AdminListBody>

          <AdminListPager nav={commissionNav} result={commissions.result} label="entries" />
        </TabsContent>
      </Tabs>

      <ConfirmActionDialog
        open={releasing !== null}
        onOpenChange={(open) => !open && setReleasing(null)}
        title="Release this commission?"
        description={
          releasing ? (
            <>
              <strong className="font-medium text-foreground">
                {formatUsdt(releasing.amountUsdt)}
              </strong>{" "}
              will be credited to{" "}
              <strong className="font-medium text-foreground">
                {releasing.beneficiaryName}
              </strong>
              &rsquo;s available balance, with a ledger entry they can see. This
              cannot be undone from here.
            </>
          ) : null
        }
        confirmLabel="Release commission"
        reason={{
          label: "Note",
          placeholder: "Anything worth recording?",
        }}
        onConfirm={(note) => {
          const entry = releasing;
          if (!entry) return;
          setReleasing(null);
          run(() =>
            releaseCommissionAction({ commissionEntryId: entry.id, note }),
          );
        }}
      />
    </AdminSection>
  );
}

/**
 * When a commission entry is due, or when it was paid.
 *
 * Three states, and they are deliberately distinguishable at a glance:
 *
 * - **credited** — the date it was actually paid. Never shown for anything
 *   still pending: a screen that displayed a release date as though it were a
 *   payment would tell an operator money had moved when it had not.
 * - **pending, due** — the release time has passed and the nightly job has not
 *   run since. Marked, because that combination means something is wrong with
 *   the scheduler rather than with the entry.
 * - **pending, scheduled** — the date it will be released on.
 *
 * `formatBusinessDateTime` writes the zone out. A release date is exactly the
 * value an operator compares against their own watch, and an unlabelled clock
 * in a zone that is not theirs is the mistake the system log already made
 * (CLAUDE.md §11).
 */
function ReleaseCell({ entry }: { entry: AdminCommissionEntry }) {
  if (entry.status === "credited") {
    return (
      <span className="text-xs text-muted-foreground">
        {entry.releasedAt ? formatBusinessDateTime(entry.releasedAt) : "Paid"}
      </span>
    );
  }
  if (entry.status === "reversed") {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (!entry.releaseAt) {
    return (
      <span className="text-xs text-muted-foreground">
        Not scheduled · release by hand
      </span>
    );
  }

  const due = new Date(entry.releaseAt).getTime() <= Date.now();
  return (
    <span className={cn("text-xs", due ? "text-warning" : "text-muted-foreground")}>
      {due ? "Due · " : ""}
      {formatBusinessDateTime(entry.releaseAt)}
    </span>
  );
}
