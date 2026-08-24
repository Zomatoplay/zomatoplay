"use client";

import { useState } from "react";
import {
  Banknote,
  Coins,
  KeyRound,
  Laptop,
  LogIn,
  LogOut,
  Lock,
  MonitorSmartphone,
  PencilLine,
  ShieldAlert,
  ShieldCheck,
  Snowflake,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { KycCasePanel } from "@/components/admin/kyc/kyc-case-panel";
import {
  ActivityTimeline,
  type TimelineEntry,
} from "@/components/admin/shared/activity-timeline";
import { AuditLogTable } from "@/components/admin/shared/audit-log-table";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import { ConfirmActionDialog } from "@/components/admin/shared/confirm-action-dialog";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import {
  DetailCard,
  DetailList,
  DetailRow,
  MonoValue,
} from "@/components/admin/shared/detail-list";
import { EmptyState } from "@/components/shared/empty-state";
import { RiskNote } from "@/components/shared/notices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { depositNetworkLabels } from "@/data/admin/deposits";
import { rewardFrequencyLabels } from "@/data/plans";
import { getVipLevel } from "@/data/referrals";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import { revokeUserSessionAction, updateUserAction } from "@/app/admin/actions";
import { formatInr, formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { AdminUser, SecurityEventType } from "@/types/admin";
import { formatDate, formatDateTime, progressPercent } from "@/utils/format";

/**
 * The tab panels of a user's profile.
 *
 * Each panel answers one support question — "where did their money go", "why
 * can't they withdraw", "who signed in from Frankfurt" — so an agent on a call
 * can find an answer without leaving the page.
 */

/* -------------------------------------------------------------------------- */
/* Overview                                                                    */
/* -------------------------------------------------------------------------- */

export function OverviewPanel({ user }: { user: AdminUser }) {
  const { referralAccounts } = useAdminStore();
  const referral = referralAccounts.find(
    (account) => account.userId === user.id,
  );
  const vip = getVipLevel(user.vipLevel);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <DetailCard title="Profile">
        <DetailList>
          <DetailRow label="Full name">{user.fullName}</DetailRow>
          <DetailRow label="Member ID">
            <span className="tabular">{user.displayId}</span>
          </DetailRow>
          <DetailRow label="Email">
            <span className="break-all">{user.email}</span>
          </DetailRow>
          <DetailRow label="Phone">
            <span className="tabular">{user.phone}</span>
          </DetailRow>
          <DetailRow label="Country">{user.country}</DetailRow>
          <DetailRow label="Registered">
            <span className="tabular">{formatDate(user.registeredAt)}</span>
          </DetailRow>
          <DetailRow label="Last active">
            <span className="tabular">{formatDateTime(user.lastActiveAt)}</span>
          </DetailRow>
          <DetailRow label="Internal ID">
            <MonoValue>{user.id}</MonoValue>
          </DetailRow>
          <DetailRow label="Deposit address" wide>
            <MonoValue>{user.walletAddress}</MonoValue>
          </DetailRow>
        </DetailList>
      </DetailCard>

      <div className="space-y-3">
        <DetailCard title="Account state">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <AdminStatusBadge kind="user" status={user.status} />
              <Badge variant={user.twoFactorEnabled ? "positive" : "outline"}>
                <ShieldCheck className="size-3" aria-hidden />
                {user.twoFactorEnabled ? "2FA on" : "2FA off"}
              </Badge>
            </div>

            <ul className="space-y-2">
              <RestrictionRow
                icon={Snowflake}
                label="Account freeze"
                active={user.restrictions.accountFrozen}
                activeText="All movement of funds halted"
                inactiveText="No hold"
              />
              <RestrictionRow
                icon={Banknote}
                label="Withdrawals"
                active={user.restrictions.withdrawalsFrozen}
                activeText="Payouts blocked"
                inactiveText="Allowed"
              />
              <RestrictionRow
                icon={TrendingDown}
                label="Investments"
                active={user.restrictions.investmentsFrozen}
                activeText="New allocations blocked"
                inactiveText="Allowed"
              />
            </ul>
          </div>
        </DetailCard>

        <DetailCard title="Referral standing">
          <DetailList columns={false}>
            <DetailRow label="Referral code">
              <span className="tabular">{user.referralCode}</span>
            </DetailRow>
            <DetailRow label="Referred by">
              {user.referredByCode ? (
                <span className="tabular">{user.referredByCode}</span>
              ) : (
                <span className="font-normal text-muted-foreground">
                  Joined directly
                </span>
              )}
            </DetailRow>
            <DetailRow label="VIP level">
              {vip?.name ?? user.vipLevel.toUpperCase()}
              <span className="ml-2 font-normal text-muted-foreground">
                {vip
                  ? `${vip.tier1CommissionPercent}% tier 1 · ${vip.tier2CommissionPercent}% tier 2`
                  : null}
              </span>
            </DetailRow>
            <DetailRow label="Referrals">
              <span className="tabular">{user.referralCount}</span>
            </DetailRow>
            {referral ? (
              <>
                <DetailRow label="Team volume">
                  <span className="tabular">
                    {formatUsdt(referral.teamVolumeUsdt)}
                  </span>
                </DetailRow>
                <DetailRow label="Commission earned">
                  <span className="tabular text-positive">
                    {formatUsdt(referral.commissionEarnedUsdt)}
                  </span>
                </DetailRow>
              </>
            ) : null}
          </DetailList>
        </DetailCard>

        <InternalNoteCard user={user} />
      </div>
    </div>
  );
}

function RestrictionRow({
  icon: Icon,
  label,
  active,
  activeText,
  inactiveText,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  activeText: string;
  inactiveText: string;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3",
        active ? "border-destructive/30 bg-destructive/5" : "border-border",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          active
            ? "bg-destructive/10 text-destructive"
            : "bg-secondary text-muted-foreground",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span
          className={cn(
            "block text-xs",
            active ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {active ? activeText : inactiveText}
        </span>
      </span>
    </li>
  );
}

function InternalNoteCard({ user }: { user: AdminUser }) {
  const store = useAdminStore();
  const { run } = useAdminAction();
  const [open, setOpen] = useState(false);
  const allowed = canManage(store.session, "user_details");

  return (
    <>
      <DetailCard
        title="Internal note"
        description="Administrators only. Never visible to the user."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!allowed}
            onClick={() => setOpen(true)}
          >
            <PencilLine className="size-4" />
            {user.internalNote ? "Edit" : "Add"}
          </Button>
        }
      >
        {user.internalNote ? (
          <p className="text-sm leading-relaxed text-muted-foreground">
            {user.internalNote}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No note on this account.</p>
        )}
      </DetailCard>

      <ConfirmActionDialog
        open={open}
        onOpenChange={setOpen}
        title="Internal note"
        description="Recorded against the account and written to the audit log."
        confirmLabel="Save note"
        reason={{
          label: "Note",
          required: true,
          placeholder: user.internalNote ?? "What should the next agent know?",
        }}
        onConfirm={(note) => {
          run(() =>
            updateUserAction({ userId: user.id, changes: { internalNote: note } }),
          );
        }}
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Edit                                                                        */
/* -------------------------------------------------------------------------- */

export function UserEditDialog({
  user,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { run } = useAdminAction();
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [phone, setPhone] = useState(user.phone);
  const [country, setCountry] = useState(user.country);

  function handleOpenChange(next: boolean) {
    if (next) {
      // Re-seed from the record each time, so a cancelled edit is discarded.
      setFullName(user.fullName);
      setEmail(user.email);
      setPhone(user.phone);
      setCountry(user.country);
    }
    onOpenChange(next);
  }

  const valid = fullName.trim() !== "" && email.trim() !== "";

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit user</SheetTitle>
          <SheetDescription>
            Changing a verified user&rsquo;s legal name or country may require
            re-verification. This is recorded in the audit log.
          </SheetDescription>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full name</Label>
            <Input
              id="edit-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-phone">Phone</Label>
            <Input
              id="edit-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-country">Country</Label>
            <Input
              id="edit-country"
              value={country}
              onChange={(event) => setCountry(event.target.value)}
            />
          </div>
        </SheetBody>

        <SheetFooter className="sm:flex-row-reverse">
          <Button
            variant="brand"
            block
            className="sm:w-auto sm:flex-1"
            disabled={!valid}
            onClick={() => {
              // `email` is deliberately not sent. It is the Supabase sign-in
              // identifier, and an operator rewriting it here would leave the
              // credential and the profile disagreeing about who the account
              // belongs to.
              run(
                () =>
                  updateUserAction({
                    userId: user.id,
                    changes: {
                      fullName: fullName.trim(),
                      phone: phone.trim(),
                      country: country.trim(),
                    },
                  }),
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            Save changes
          </Button>
          <Button
            variant="outline"
            block
            className="sm:w-auto sm:flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/* Investments                                                                 */
/* -------------------------------------------------------------------------- */

export function InvestmentsPanel({ user }: { user: AdminUser }) {
  const { investments } = useAdminStore();
  const rows = investments.filter((row) => row.userId === user.id);

  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: "id",
      header: "Investment",
      cell: (row) => <PrimaryCell title={row.planName} subtitle={row.id} />,
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
        <span className="text-positive">
          {formatUsdt(row.profitUsdt, { withSymbol: false })}
        </span>
      ),
    },
    {
      id: "term",
      header: "Term",
      hideBelow: "lg",
      cell: (row) => (
        <span className="flex min-w-32 flex-col gap-1">
          <span className="tabular text-xs text-muted-foreground">
            {row.durationDays === 0
              ? "No lock-in"
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
      hideBelow: "xl",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.durationDays === 0 ? "—" : formatDate(row.maturesAt)}
        </span>
      ),
    },
    {
      id: "next",
      header: "Next reward",
      numeric: true,
      hideBelow: "lg",
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
    <div className="space-y-3">
      <DataTable
        rows={rows}
        columns={columns}
        getRowKey={(row) => row.id}
        caption={`Allocations created by ${user.fullName}`}
        empty={
          <EmptyState
            icon={TrendingUp}
            title="No investments"
            description="This user has not allocated into any plan."
          />
        }
        renderCard={(row) => (
          <DataCard>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.planName}</p>
                <p className="tabular text-xs text-muted-foreground">{row.id}</p>
              </div>
              <AdminStatusBadge kind="investment" status={row.status} />
            </div>
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
            <DataCardRow label="Started">
              <span className="tabular font-normal text-muted-foreground">
                {formatDate(row.startedAt)}
              </span>
            </DataCardRow>
          </DataCard>
        )}
      />
      {rows.length > 0 ? <RiskNote /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Deposits                                                                    */
/* -------------------------------------------------------------------------- */

export function DepositsPanel({ user }: { user: AdminUser }) {
  const { deposits } = useAdminStore();
  const rows = deposits.filter((deposit) => deposit.userId === user.id);

  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: "id",
      header: "Deposit",
      cell: (row) => (
        <PrimaryCell title={row.id} subtitle={formatDate(row.createdAt)} />
      ),
    },
    {
      id: "amount",
      header: "Amount",
      numeric: true,
      cell: (row) => formatUsdt(row.amountUsdt, { withSymbol: false }),
    },
    {
      id: "network",
      header: "Network",
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {depositNetworkLabels[row.network]}
        </span>
      ),
    },
    {
      id: "tx",
      header: "Transaction",
      hideBelow: "xl",
      cell: (row) => (
        <MonoValue className="block max-w-[14rem] truncate text-muted-foreground">
          {row.txHash}
        </MonoValue>
      ),
    },
    {
      id: "confirmations",
      header: "Confirmations",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.confirmations.current} / {row.confirmations.required}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <AdminStatusBadge kind="deposit" status={row.status} />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(row) => row.id}
      caption={`Deposits made by ${user.fullName}`}
      empty={
        <EmptyState
          icon={Wallet}
          title="No deposits"
          description="This user has not deposited any funds."
        />
      }
      renderCard={(row) => (
        <DataCard>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="tabular text-sm font-medium">{row.id}</p>
              <p className="tabular text-xs text-muted-foreground">
                {formatDate(row.createdAt)}
              </p>
            </div>
            <AdminStatusBadge kind="deposit" status={row.status} />
          </div>
          <DataCardRow label="Amount">
            <span className="tabular">{formatUsdt(row.amountUsdt)}</span>
          </DataCardRow>
          <DataCardRow label="Network">
            {depositNetworkLabels[row.network]}
          </DataCardRow>
          <DataCardRow label="Confirmations">
            <span className="tabular">
              {row.confirmations.current} / {row.confirmations.required}
            </span>
          </DataCardRow>
        </DataCard>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Withdrawals                                                                 */
/* -------------------------------------------------------------------------- */

export function WithdrawalsPanel({ user }: { user: AdminUser }) {
  const { withdrawals } = useAdminStore();
  const rows = withdrawals.filter((withdrawal) => withdrawal.userId === user.id);

  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: "id",
      header: "Withdrawal",
      cell: (row) => (
        <PrimaryCell title={row.id} subtitle={formatDate(row.requestedAt)} />
      ),
    },
    {
      id: "amount",
      header: "USDT",
      numeric: true,
      cell: (row) => formatUsdt(row.amountUsdt, { withSymbol: false }),
    },
    {
      id: "rate",
      header: "Rate",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          ₹{row.payoutRate.toFixed(2)}
        </span>
      ),
    },
    {
      id: "fees",
      header: "Fees",
      numeric: true,
      hideBelow: "xl",
      cell: (row) => formatUsdt(row.totalFeeUsdt, { withSymbol: false }),
    },
    {
      id: "net",
      header: "Net INR",
      numeric: true,
      cell: (row) => formatInr(row.netInr, { approximate: false }),
    },
    {
      id: "destination",
      header: "Destination",
      hideBelow: "lg",
      cell: (row) => (
        <span className="flex flex-col text-xs">
          <span>{row.destination.bankName}</span>
          <span className="tabular text-muted-foreground">
            {row.destination.accountNumberMasked}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <AdminStatusBadge kind="withdrawal" status={row.status} />,
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      getRowKey={(row) => row.id}
      caption={`Withdrawal requests made by ${user.fullName}`}
      empty={
        <EmptyState
          icon={Banknote}
          title="No withdrawals"
          description="This user has not requested a payout."
        />
      }
      renderCard={(row) => (
        <DataCard>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="tabular text-sm font-medium">{row.id}</p>
              <p className="tabular text-xs text-muted-foreground">
                {formatDate(row.requestedAt)}
              </p>
            </div>
            <AdminStatusBadge kind="withdrawal" status={row.status} />
          </div>
          <DataCardRow label="Amount">
            <span className="tabular">{formatUsdt(row.amountUsdt)}</span>
          </DataCardRow>
          <DataCardRow label="Net payout">
            <span className="tabular">
              {formatInr(row.netInr, { approximate: false })}
            </span>
          </DataCardRow>
          <DataCardRow label="Destination">
            {row.destination.bankName} {row.destination.accountNumberMasked}
          </DataCardRow>
        </DataCard>
      )}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Profits / rewards                                                           */
/* -------------------------------------------------------------------------- */

export function RewardsPanel({ user }: { user: AdminUser }) {
  const store = useAdminStore();
  const investments = store.investments.filter((row) => row.userId === user.id);
  const commissions = store.commissionLedger.filter(
    (entry) => entry.beneficiaryUserId === user.id,
  );

  const accrued = investments.reduce((sum, row) => sum + row.profitUsdt, 0);
  const projected = investments
    .filter((row) => row.status === "active")
    .reduce((sum, row) => sum + row.projectedProfitUsdt, 0);
  const commissionTotal = commissions
    .filter((entry) => entry.status === "credited")
    .reduce((sum, entry) => sum + entry.amountUsdt, 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          icon={Coins}
          label="Profit accrued"
          value={formatUsdt(accrued)}
          hint={formatUsdtAsInr(accrued)}
          tone="positive"
        />
        <SummaryTile
          icon={TrendingUp}
          label="Projected at maturity"
          value={formatUsdt(projected)}
          hint="Estimate on active allocations — not guaranteed"
        />
        <SummaryTile
          icon={Users}
          label="Referral commission"
          value={formatUsdt(commissionTotal)}
          hint={`${commissions.length} ledger entries`}
          tone="positive"
        />
      </div>

      <DetailCard
        title="Reward schedule"
        description="Accrual and the next scheduled credit for each allocation."
      >
        {investments.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No allocations, so no rewards are scheduled.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {investments.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{row.planName}</p>
                  <p className="tabular text-xs text-muted-foreground">
                    {row.id} · {rewardFrequencyLabels[row.rewardFrequency]}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="tabular text-sm font-medium text-positive">
                    {formatUsdt(row.profitUsdt)}
                  </span>
                  <span className="tabular text-xs text-muted-foreground">
                    {row.nextRewardAt
                      ? `Next ${formatDate(row.nextRewardAt)}`
                      : "No further rewards"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailCard>

      <RiskNote>
        Profit figures are accrued and projected values from the prototype
        investment model. Projections are estimates and are never guaranteed.
      </RiskNote>
    </div>
  );
}

function SummaryTile({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "positive";
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p
        className={cn(
          "tabular mt-2 text-xl font-semibold tracking-tight",
          tone === "positive" ? "text-positive" : "text-foreground",
        )}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Referrals                                                                   */
/* -------------------------------------------------------------------------- */

export function ReferralsPanel({ user }: { user: AdminUser }) {
  const { referralAccounts, commissionLedger } = useAdminStore();
  const account = referralAccounts.find(
    (entry) => entry.userId === user.id,
  );
  const commissions = commissionLedger.filter(
    (entry) => entry.beneficiaryUserId === user.id,
  );
  const vip = getVipLevel(user.vipLevel);

  return (
    <div className="space-y-3">
      <DetailCard title="Referral account">
        <DetailList>
          <DetailRow label="Referral code">
            <span className="tabular">{user.referralCode}</span>
          </DetailRow>
          <DetailRow label="VIP level">
            {vip?.name ?? user.vipLevel.toUpperCase()}
          </DetailRow>
          <DetailRow label="Tier 1 commission">
            {vip ? `${vip.tier1CommissionPercent}%` : "—"}
          </DetailRow>
          <DetailRow label="Tier 2 commission">
            {vip ? `${vip.tier2CommissionPercent}%` : "—"}
          </DetailRow>
          <DetailRow label="Direct referrals">
            <span className="tabular">{account?.directReferrals ?? 0}</span>
          </DetailRow>
          <DetailRow label="Second-tier referrals">
            <span className="tabular">{account?.indirectReferrals ?? 0}</span>
          </DetailRow>
          <DetailRow label="Active referrals">
            <span className="tabular">{account?.activeReferrals ?? 0}</span>
          </DetailRow>
          <DetailRow label="Team volume">
            <span className="tabular">
              {formatUsdt(account?.teamVolumeUsdt ?? 0)}
            </span>
          </DetailRow>
          <DetailRow label="Commission earned">
            <span className="tabular text-positive">
              {formatUsdt(account?.commissionEarnedUsdt ?? 0)}
            </span>
          </DetailRow>
          <DetailRow label="Commission pending">
            <span className="tabular">
              {formatUsdt(account?.commissionPendingUsdt ?? 0)}
            </span>
          </DetailRow>
        </DetailList>
      </DetailCard>

      <DetailCard title="Commission history">
        {commissions.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No commission has been earned by this account.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {commissions.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    From {entry.sourceUserName}
                  </p>
                  <p className="tabular text-xs text-muted-foreground">
                    Tier {entry.tier} · {entry.sourcePlanName} ·{" "}
                    {formatDate(entry.createdAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="tabular text-sm font-medium text-positive">
                    {formatUsdt(entry.amountUsdt)}
                  </span>
                  <AdminStatusBadge kind="commission" status={entry.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </DetailCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* KYC                                                                         */
/* -------------------------------------------------------------------------- */

export function KycPanel({ user }: { user: AdminUser }) {
  const { kyc } = useAdminStore();
  const submissions = kyc.filter((submission) => submission.userId === user.id);

  if (submissions.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No verification submitted"
        description={`${user.fullName} has not submitted any identity documents yet.`}
      />
    );
  }

  return (
    <div className="space-y-5">
      {submissions.map((submission) => (
        <KycCasePanel
          key={submission.id}
          submission={submission}
          showUserLink={false}
        />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Devices & sessions                                                          */
/* -------------------------------------------------------------------------- */

export function SessionsPanel({ user }: { user: AdminUser }) {
  const { run } = useAdminAction();
  const store = useAdminStore();
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [logoutAll, setLogoutAll] = useState(false);

  const rows = store.sessions.filter((session) => session.userId === user.id);
  const allowed = canManage(store.session, "security");
  const activeCount = rows.filter((session) => session.status === "active").length;
  const target = rows.find((session) => session.id === pendingSession);

  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      id: "device",
      header: "Device",
      cell: (row) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
            {row.os.startsWith("iOS") || row.os.startsWith("Android") ? (
              <MonitorSmartphone className="size-4" aria-hidden />
            ) : (
              <Laptop className="size-4" aria-hidden />
            )}
          </span>
          <PrimaryCell
            title={
              <>
                {row.device}
                {row.current ? (
                  <Badge variant="brand" className="ml-2">
                    This device
                  </Badge>
                ) : null}
              </>
            }
            subtitle={`${row.browser} · ${row.os}`}
          />
        </span>
      ),
    },
    {
      id: "ip",
      header: "IP address",
      hideBelow: "lg",
      cell: (row) => (
        <MonoValue className="text-muted-foreground">{row.ipAddress}</MonoValue>
      ),
    },
    {
      id: "location",
      header: "Location",
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-sm text-muted-foreground">{row.location}</span>
      ),
    },
    {
      id: "loggedIn",
      header: "Signed in",
      numeric: true,
      hideBelow: "xl",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(row.loggedInAt)}
        </span>
      ),
    },
    {
      id: "lastActive",
      header: "Last active",
      numeric: true,
      hideBelow: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {formatDateTime(row.lastActiveAt)}
        </span>
      ),
    },
    {
      id: "status",
      header: "Session",
      cell: (row) => <AdminStatusBadge kind="session" status={row.status} />,
    },
    {
      id: "actions",
      header: "Actions",
      srOnlyHeader: true,
      numeric: true,
      cell: (row) =>
        row.status === "active" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!allowed}
            onClick={() => setPendingSession(row.id)}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="tabular font-medium text-foreground">
            {activeCount}
          </span>{" "}
          active {activeCount === 1 ? "session" : "sessions"} across{" "}
          {rows.length} known {rows.length === 1 ? "device" : "devices"}.
        </p>
        <Button
          variant="destructive"
          size="sm"
          disabled={!allowed || activeCount === 0}
          onClick={() => setLogoutAll(true)}
        >
          <LogOut className="size-4" />
          Log out all devices
        </Button>
      </div>

      <DataTable
        rows={rows}
        columns={columns}
        getRowKey={(row) => row.id}
        caption={`Devices and sessions for ${user.fullName}`}
        empty={
          <EmptyState
            icon={MonitorSmartphone}
            title="No known devices"
            description="This account has no recorded sessions."
          />
        }
        renderCard={(row) => (
          <DataCard>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{row.device}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {row.browser} · {row.os}
                </p>
              </div>
              <AdminStatusBadge kind="session" status={row.status} />
            </div>
            <DataCardRow label="IP">
              <MonoValue>{row.ipAddress}</MonoValue>
            </DataCardRow>
            <DataCardRow label="Location">{row.location}</DataCardRow>
            <DataCardRow label="Last active">
              <span className="tabular font-normal text-muted-foreground">
                {formatDateTime(row.lastActiveAt)}
              </span>
            </DataCardRow>
            {row.status === "active" ? (
              <Button
                variant="outline"
                size="sm"
                block
                disabled={!allowed}
                onClick={() => setPendingSession(row.id)}
              >
                <LogOut className="size-4" />
                Sign out this device
              </Button>
            ) : null}
          </DataCard>
        )}
      />

      <ConfirmActionDialog
        open={pendingSession !== null}
        onOpenChange={(open) => !open && setPendingSession(null)}
        title="Sign out this device?"
        description={
          target ? (
            <>
              The session on{" "}
              <strong className="font-medium text-foreground">
                {target.device}
              </strong>{" "}
              ({target.browser}, {target.location}) will be revoked immediately.
            </>
          ) : (
            "This session will be revoked immediately."
          )
        }
        confirmLabel="Sign out device"
        destructive
        reason={{ label: "Reason", placeholder: "Why is this session being revoked?" }}
        onConfirm={(reason) => {
          if (!pendingSession) return;
          run(() =>
            revokeUserSessionAction({
              userId: user.id,
              sessionId: pendingSession,
              reason,
            }),
          );
        }}
      />

      <ConfirmActionDialog
        open={logoutAll}
        onOpenChange={setLogoutAll}
        title="Log out all devices?"
        description={
          <>
            All {activeCount} active {activeCount === 1 ? "session" : "sessions"}{" "}
            for{" "}
            <strong className="font-medium text-foreground">
              {user.fullName}
            </strong>{" "}
            will be revoked, including the device they are using right now.
          </>
        }
        confirmLabel="Log out all devices"
        destructive
        reason={{
          label: "Reason",
          required: true,
          presets: [
            "Suspected account compromise",
            "Requested by the user",
            "Unrecognised sign-in location",
          ],
        }}
        onConfirm={(reason) => {
          run(() => revokeUserSessionAction({ userId: user.id, reason }));
        }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

const SECURITY_ICONS: Record<SecurityEventType, LucideIcon> = {
  login: LogIn,
  failed_login: ShieldAlert,
  password_changed: KeyRound,
  two_factor_changed: ShieldCheck,
  account_locked: Lock,
  device_logged_out: LogOut,
  withdrawal_address_added: Banknote,
};

export function SecurityPanel({ user }: { user: AdminUser }) {
  const { securityEvents } = useAdminStore();
  const events = securityEvents.filter((event) => event.userId === user.id);

  const entries: TimelineEntry[] = events
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((event) => ({
      id: event.id,
      title: event.description,
      timestamp: event.createdAt,
      icon: SECURITY_ICONS[event.type],
      tone: event.outcome === "blocked" ? "negative" : "default",
      meta: `${event.device} · ${event.ipAddress} · ${event.location}`,
    }));

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_1fr]">
      <DetailCard title="Security settings">
        <DetailList columns={false}>
          <DetailRow label="Two-factor authentication">
            <Badge variant={user.twoFactorEnabled ? "positive" : "outline"}>
              <ShieldCheck className="size-3" aria-hidden />
              {user.twoFactorEnabled ? "Enabled" : "Not enabled"}
            </Badge>
          </DetailRow>
          <DetailRow label="Account status">
            <AdminStatusBadge kind="user" status={user.status} />
          </DetailRow>
          <DetailRow label="Withdrawal hold">
            {user.restrictions.withdrawalsFrozen ? "Frozen" : "None"}
          </DetailRow>
          <DetailRow label="Recorded events">
            <span className="tabular">{events.length}</span>
          </DetailRow>
        </DetailList>
      </DetailCard>

      <DetailCard title="Security events">
        <ActivityTimeline entries={entries} />
      </DetailCard>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Activity                                                                    */
/* -------------------------------------------------------------------------- */

export function ActivityPanel({ user }: { user: AdminUser }) {
  const { auditLog } = useAdminStore();
  const entries = auditLog.filter(
    (entry) => entry.target?.type === "user" && entry.target.id === user.id,
  );

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Administrative actions taken on this account, newest first. Actions the
        user took themselves appear under Security.
      </p>
      <AuditLogTable entries={entries} pageSize={10} />
    </div>
  );
}
