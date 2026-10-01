"use client";

import { useState } from "react";
import Link from "next/link";
import { Banknote } from "lucide-react";

import { AdminSection } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import {
  AdminStatCard,
  AdminStatGrid,
} from "@/components/admin/shared/admin-stat-card";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import { DetailList, DetailRow } from "@/components/admin/shared/detail-list";
import type { FilterOption } from "@/components/admin/shared/filter-bar";
import {
  AdminListBody,
  AdminListControls,
  AdminListPager,
  useAdminListNavigation,
} from "@/components/admin/shared/admin-list-controls";
import { EmptyState } from "@/components/shared/empty-state";
import { PrototypeNote } from "@/components/shared/notices";
import { Button } from "@/components/ui/button";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import { withdrawalRejectionReasons } from "@/data/admin/withdrawals";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import {
  approveWithdrawalAction,
  markWithdrawalPaidAction,
  rejectWithdrawalAction,
} from "@/app/admin/actions";
import { formatInr, formatUsdt } from "@/lib/currency";
import type {
  AdminListPage,
  AdminListQuery,
  AdminWithdrawal,
  AdminWithdrawalsSummary,
} from "@/types/admin";
import { formatDateTime } from "@/utils/format";

/**
 * Withdrawal queue.
 *
 * Every row shows the full payout arithmetic — gross USDT, the rate that was
 * quoted at request time, each fee and the exact INR the user receives. An
 * operator approving a payout should never have to recompute what the user was
 * promised, and the quoted rate is deliberately distinct from the indicative
 * display rate used elsewhere.
 */

const SPEC = ADMIN_LIST_SPECS.withdrawals;

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  pending: "Pending",
  under_review: "Under review",
  approved: "Approved",
  processing: "Processing",
  paid: "Paid",
  rejected: "Rejected",
  failed: "Failed",
};

const SORT_OPTIONS: FilterOption<string>[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "amount", label: "Largest amount" },
];

export function WithdrawalsBrowser({
  page,
  query,
}: {
  page: AdminListPage<AdminWithdrawal> & { summary: AdminWithdrawalsSummary };
  query: AdminListQuery;
}) {
  const store = useAdminStore();
  const { run } = useAdminAction();
  const [approving, setApproving] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const nav = useAdminListNavigation(query, SPEC);

  const allowed = canManage(store.session, "withdrawals");
  const threshold = store.settings.withdrawals.manualReviewThresholdUsdt;

  const { result, statusCounts, summary } = page;
  const withdrawals = result.rows;

  const options: FilterOption<string>[] = SPEC.statuses.map((value) => ({
    value,
    label: STATUS_LABELS[value] ?? value,
    count: statusCounts[value] ?? 0,
  }));

  /*
   * Queue-wide figures, from SQL. Reducing over `withdrawals` here would count
   * only the ten rows on screen — and "Open requests 4" computed over a page
   * is not a smaller number than the truth, it is a different one.
   */
  const openCount = summary.openCount;
  const openValue = summary.openUsdt;
  const paidValue = summary.paidNetInr;

  const approveTarget = withdrawals.find((w) => w.id === approving);
  const rejectTarget = withdrawals.find((w) => w.id === rejecting);
  const payTarget = withdrawals.find((w) => w.id === paying);

  const isOpen = (withdrawal: AdminWithdrawal) =>
    withdrawal.status === "pending" || withdrawal.status === "under_review";
  const isPayable = (withdrawal: AdminWithdrawal) =>
    withdrawal.status === "approved" || withdrawal.status === "processing";

  const columns: DataTableColumn<AdminWithdrawal>[] = [
    {
      id: "id",
      header: "Withdrawal",
      cell: (withdrawal) => (
        <PrimaryCell
          title={withdrawal.id}
          subtitle={formatDateTime(withdrawal.requestedAt)}
        />
      ),
    },
    {
      id: "user",
      header: "User",
      cell: (withdrawal) => (
        <Link
          href={`/admin/users/${withdrawal.userId}`}
          className="block rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <PrimaryCell
            title={withdrawal.userName}
            subtitle={withdrawal.userDisplayId}
          />
        </Link>
      ),
    },
    {
      id: "amount",
      header: "USDT",
      numeric: true,
      cell: (withdrawal) => formatUsdt(withdrawal.amountUsdt, { withSymbol: false }),
    },
    {
      id: "rate",
      header: "Rate",
      numeric: true,
      hideBelow: "lg",
      cell: (withdrawal) => (
        <span className="text-xs text-muted-foreground">
          ₹{withdrawal.payoutRate.toFixed(2)}
        </span>
      ),
    },
    {
      id: "fees",
      header: "Fees",
      numeric: true,
      hideBelow: "xl",
      cell: (withdrawal) => (
        <span className="text-xs text-muted-foreground">
          {formatUsdt(withdrawal.totalFeeUsdt, { withSymbol: false })}
        </span>
      ),
    },
    {
      id: "net",
      header: "Net INR",
      numeric: true,
      cell: (withdrawal) => (
        <span className="font-medium">
          {formatInr(withdrawal.netInr, { approximate: false })}
        </span>
      ),
    },
    {
      id: "destination",
      header: "Destination",
      hideBelow: "lg",
      cell: (withdrawal) => (
        <span className="flex flex-col text-xs">
          <span>{withdrawal.destination.bankName}</span>
          <span className="tabular text-muted-foreground">
            {withdrawal.destination.accountNumberMasked}
          </span>
        </span>
      ),
    },
    {
      id: "reviewer",
      header: "Reviewer",
      hideBelow: "xl",
      cell: (withdrawal) => (
        <span className="text-xs text-muted-foreground">
          {withdrawal.reviewedBy ?? "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (withdrawal) => (
        <AdminStatusBadge kind="withdrawal" status={withdrawal.status} />
      ),
    },
    {
      id: "actions",
      header: "Actions",
      srOnlyHeader: true,
      numeric: true,
      cell: (withdrawal) => (
        <span className="flex justify-end gap-1.5">
          {isOpen(withdrawal) ? (
            <>
              <Button
                variant="brand"
                size="sm"
                disabled={!allowed}
                onClick={() => setApproving(withdrawal.id)}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!allowed}
                onClick={() => setRejecting(withdrawal.id)}
              >
                Reject
              </Button>
            </>
          ) : isPayable(withdrawal) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed}
              onClick={() => setPaying(withdrawal.id)}
            >
              Mark paid
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <AdminSection className="space-y-4">
      <PrototypeNote>
        No payment rail is connected. Approving or marking a withdrawal paid
        records your decision and an audit entry; the payout itself is sent
        outside this console.
      </PrototypeNote>

      <AdminStatGrid className="md:grid-cols-3 xl:grid-cols-3">
        <AdminStatCard
          label="Open requests"
          value={openCount}
          icon={Banknote}
          tone={openCount > 0 ? "warning" : "default"}
          hint={`${formatUsdt(openValue, { withSymbol: false })} USDT awaiting payout`}
        />
        <AdminStatCard
          label="Paid to date"
          value={formatInr(paidValue, { approximate: false })}
          hint="Total INR settled to users"
          tone="positive"
        />
        <AdminStatCard
          label="Manual review threshold"
          value={formatUsdt(threshold, { withSymbol: false })}
          hint="Requests above this always need a reviewer"
        />
      </AdminStatGrid>

      <AdminListControls
        nav={nav}
        query={query}
        spec={SPEC}
        searchLabel="Search withdrawals"
        searchPlaceholder="Withdrawal ID, user name, email or member ID"
        statusOptions={options}
        sortOptions={SORT_OPTIONS}
        statusLabel="Filter by withdrawal status"
      />

      <AdminListBody nav={nav}>
        <DataTable
          rows={withdrawals}
          columns={columns}
          getRowKey={(withdrawal) => withdrawal.id}
          caption="INR payout requests with rate, fees, net amount and status"
          empty={
            <EmptyState
              icon={Banknote}
              title="No matching withdrawals"
              description="No payout request matches the current search and filters."
            />
          }
          renderCard={(withdrawal) => (
            <DataCard>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="tabular text-sm font-medium">{withdrawal.id}</p>
                  <Link
                    href={`/admin/users/${withdrawal.userId}`}
                    className="truncate text-xs text-brand"
                  >
                    {withdrawal.userName}
                  </Link>
                </div>
                <AdminStatusBadge kind="withdrawal" status={withdrawal.status} />
              </div>
              <DataCardRow label="Amount">
                <span className="tabular">{formatUsdt(withdrawal.amountUsdt)}</span>
              </DataCardRow>
              <DataCardRow label="Rate">
                <span className="tabular">₹{withdrawal.payoutRate.toFixed(2)}</span>
              </DataCardRow>
              <DataCardRow label="Fees">
                <span className="tabular">
                  {formatUsdt(withdrawal.totalFeeUsdt)}
                </span>
              </DataCardRow>
              <DataCardRow label="Net payout">
                <span className="tabular">
                  {formatInr(withdrawal.netInr, { approximate: false })}
                </span>
              </DataCardRow>
              <DataCardRow label="Destination">
                {withdrawal.destination.bankName}{" "}
                {withdrawal.destination.accountNumberMasked}
              </DataCardRow>
              {isOpen(withdrawal) ? (
                <div className="flex gap-2">
                  <Button
                    variant="brand"
                    size="sm"
                    className="flex-1"
                    disabled={!allowed}
                    onClick={() => setApproving(withdrawal.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={!allowed}
                    onClick={() => setRejecting(withdrawal.id)}
                  >
                    Reject
                  </Button>
                </div>
              ) : isPayable(withdrawal) ? (
                <Button
                  variant="outline"
                  size="sm"
                  block
                  disabled={!allowed}
                  onClick={() => setPaying(withdrawal.id)}
                >
                  Mark paid
                </Button>
              ) : null}
            </DataCard>
          )}
        />
      </AdminListBody>

      <AdminListPager nav={nav} result={result} label="withdrawals" />

      <ConfirmActionDialog
        open={approving !== null}
        onOpenChange={(open) => !open && setApproving(null)}
        title="Approve this withdrawal?"
        description={
          approveTarget ? (
            <>
              Approving releases the payout to{" "}
              <strong className="font-medium text-foreground">
                {approveTarget.userName}
              </strong>
              &rsquo;s bank account. Check the beneficiary details against their
              verified identity first.
            </>
          ) : null
        }
        confirmLabel="Approve payout"
        reason={{ label: "Note", placeholder: "Anything worth recording?" }}
        onConfirm={(note) => {
          if (!approving) return;
          run(() => approveWithdrawalAction({ withdrawalId: approving, note }));
          setApproving(null);
        }}
      >
        {approveTarget ? <PayoutBreakdown withdrawal={approveTarget} /> : null}
      </ConfirmActionDialog>

      <ConfirmActionDialog
        open={rejecting !== null}
        onOpenChange={(open) => !open && setRejecting(null)}
        title="Reject this withdrawal?"
        description={
          rejectTarget ? (
            <>
              {rejectTarget.id} will be closed and{" "}
              {formatUsdt(rejectTarget.amountUsdt)} returned to{" "}
              {rejectTarget.userName}&rsquo;s available balance. The reason is
              shown to them.
            </>
          ) : null
        }
        confirmLabel="Reject withdrawal"
        destructive
        reason={{
          label: "Reason for rejection",
          required: true,
          presets: withdrawalRejectionReasons,
        }}
        onConfirm={(reason) => {
          if (!rejecting) return;
          // Returns the held balance as its own ledger entry, so the user's
          // history shows the hold and its reversal rather than a balance that
          // silently came back.
          run(() => rejectWithdrawalAction({ withdrawalId: rejecting, reason }));
          setRejecting(null);
        }}
      />

      <ConfirmActionDialog
        open={paying !== null}
        onOpenChange={(open) => !open && setPaying(null)}
        title="Mark this withdrawal paid?"
        description={
          payTarget ? (
            <>
              Confirm that{" "}
              <strong className="font-medium text-foreground">
                {formatInr(payTarget.netInr, { approximate: false })}
              </strong>{" "}
              has actually left the payout account and reached{" "}
              {payTarget.destination.bankName}{" "}
              {payTarget.destination.accountNumberMasked}.
            </>
          ) : null
        }
        confirmLabel="Mark paid"
        reason={{
          label: "Payout reference",
          placeholder: "NEFT / IMPS reference from the banking portal",
        }}
        onConfirm={(reference) => {
          if (!paying) return;
          // Records that an operator sent the money by some means outside this
          // system. Nothing here pays anyone — there is no payout rail.
          run(() =>
            markWithdrawalPaidAction({
              withdrawalId: paying,
              payoutReference: reference,
            }),
          );
          setPaying(null);
        }}
      >
        {payTarget ? <PayoutBreakdown withdrawal={payTarget} /> : null}
      </ConfirmActionDialog>
    </AdminSection>
  );
}

/** The full payout arithmetic, so nothing has to be recomputed by hand. */
function PayoutBreakdown({ withdrawal }: { withdrawal: AdminWithdrawal }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/40 p-3">
      <DetailList columns={false} className="divide-y-0">
        <DetailRow label="Gross amount">
          <span className="tabular">{formatUsdt(withdrawal.amountUsdt)}</span>
        </DetailRow>
        <DetailRow label="Flat fee">
          <span className="tabular">−{formatUsdt(withdrawal.flatFeeUsdt)}</span>
        </DetailRow>
        <DetailRow label="Percentage fee">
          <span className="tabular">−{formatUsdt(withdrawal.percentFeeUsdt)}</span>
        </DetailRow>
        <DetailRow label="Quoted payout rate">
          <span className="tabular">
            1 USDT = ₹{withdrawal.payoutRate.toFixed(2)}
          </span>
        </DetailRow>
        <DetailRow label="Net paid to user">
          <span className="tabular text-base font-semibold">
            {formatInr(withdrawal.netInr, { approximate: false })}
          </span>
        </DetailRow>
      </DetailList>
    </div>
  );
}
