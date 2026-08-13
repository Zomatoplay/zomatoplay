"use client";

import {
  BadgeCheck,
  Ban,
  Banknote,
  Coins,
  Gift,
  Hourglass,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import {
  RecentDeposits,
  RecentInvestments,
  RecentKycSubmissions,
  RecentRegistrations,
  RecentSecurityEvents,
  RecentWithdrawals,
} from "@/components/admin/dashboard/recent-panels";
import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import {
  PlatformFlowChart,
  SeriesBarChart,
  StatusBreakdownBar,
  TrendChart,
} from "@/components/admin/shared/admin-charts";
import {
  AdminStatCard,
  AdminStatGrid,
} from "@/components/admin/shared/admin-stat-card";
import { PrototypeNote, RateNote } from "@/components/shared/notices";
import {
  adminMetrics,
  allocationByPlan,
  investedMonthly,
  kycPipeline,
  platformFlowWeekly,
  registrationsMonthly,
} from "@/data/admin/metrics";
import { formatUsdt, formatUsdtCompact } from "@/lib/currency";
import { useAdminStore } from "@/lib/admin-store";

/**
 * Plan-mix segment colours, in the order the plans are listed. Slots are
 * assigned by position and never recomputed from the data, so a plan keeps its
 * colour when the figures change.
 */
const PLAN_MIX_COLORS = [
  "bg-chart-1",
  "bg-chart-2",
  "bg-chart-5",
  "bg-chart-4",
  "bg-border",
];

/**
 * The CRM's landing screen: platform totals, the queues that need attention,
 * four charts and six "what just happened" panels.
 *
 * Pending counts come from the live store rather than the static metrics
 * module, so crediting a deposit or approving a withdrawal is visibly reflected
 * here. The platform-wide aggregates stay in `@/data/admin/metrics` because a
 * real deployment computes them server-side rather than by summing rows on the
 * client.
 */
export function DashboardView() {
  const { users, deposits, withdrawals, kyc } = useAdminStore();

  const pendingDeposits = deposits.filter(
    (deposit) =>
      deposit.status === "pending" ||
      deposit.status === "detected" ||
      deposit.status === "confirming" ||
      deposit.status === "confirmed",
  );
  const pendingWithdrawals = withdrawals.filter(
    (withdrawal) =>
      withdrawal.status === "pending" ||
      withdrawal.status === "under_review" ||
      withdrawal.status === "approved" ||
      withdrawal.status === "processing",
  );
  const pendingKyc = kyc.filter(
    (submission) =>
      submission.status === "pending" || submission.status === "under_review",
  );
  const blockedUsers = users.filter(
    (user) => user.status === "blocked" || user.status === "suspended",
  );

  const pendingDepositValue = pendingDeposits.reduce(
    (sum, deposit) => sum + deposit.amountUsdt,
    0,
  );
  const pendingWithdrawalValue = pendingWithdrawals.reduce(
    (sum, withdrawal) => sum + withdrawal.amountUsdt,
    0,
  );

  return (
    <>
      <AdminHeader
        title="Dashboard"
        description="Platform health, open queues and recent activity."
      />

      <AdminPage className="space-y-6">
        <PrototypeNote>
          Prototype build — every figure, account and document below is sample
          data. No real funds, users or verification records are involved.
        </PrototypeNote>

        {/* -------------------------------------------------- Queues */}

        <AdminSection
          title="Needs attention"
          description="Open queues, counted from the live prototype state."
        >
          <AdminStatGrid className="xl:grid-cols-4">
            <AdminStatCard
              label="KYC awaiting review"
              value={pendingKyc.length}
              icon={BadgeCheck}
              tone={pendingKyc.length > 0 ? "warning" : "default"}
              hint="Pending and under review"
              href="/admin/kyc"
            />
            <AdminStatCard
              label="Deposits not yet credited"
              value={pendingDeposits.length}
              icon={Wallet}
              tone={pendingDeposits.length > 0 ? "warning" : "default"}
              hint={`${formatUsdt(pendingDepositValue, { withSymbol: false })} USDT in flight`}
              href="/admin/deposits"
            />
            <AdminStatCard
              label="Withdrawals in progress"
              value={pendingWithdrawals.length}
              icon={Banknote}
              tone={pendingWithdrawals.length > 0 ? "warning" : "default"}
              hint={`${formatUsdt(pendingWithdrawalValue, { withSymbol: false })} USDT to pay out`}
              href="/admin/withdrawals"
            />
            <AdminStatCard
              label="Blocked or suspended"
              value={blockedUsers.length}
              icon={Ban}
              tone={blockedUsers.length > 0 ? "negative" : "default"}
              hint="Accounts under a restriction"
              href="/admin/users"
            />
          </AdminStatGrid>
        </AdminSection>

        {/* --------------------------------------------------- Totals */}

        <AdminSection
          title="Platform totals"
          description="All-time figures across every account."
        >
          <AdminStatGrid>
            <AdminStatCard
              label="Total users"
              value={adminMetrics.totalUsers}
              icon={Users}
              hint={`${adminMetrics.activeUsers.toLocaleString("en-IN")} active`}
            />
            <AdminStatCard
              label="New users this month"
              value={adminMetrics.newUsersThisMonth}
              icon={UserPlus}
              tone="positive"
              hint="Registrations since 01 Aug"
            />
            <AdminStatCard
              label="KYC approved"
              value={adminMetrics.kycApproved}
              icon={ShieldCheck}
              hint={`${adminMetrics.kycRejected} rejected`}
            />
            <AdminStatCard
              label="KYC pending"
              value={adminMetrics.kycPending}
              icon={Hourglass}
              hint="Across the whole platform"
            />
            <AdminStatCard
              label="Total deposits"
              amount={adminMetrics.totalDepositsUsdt}
              icon={Wallet}
              showInr
            />
            <AdminStatCard
              label="Total withdrawals"
              amount={adminMetrics.totalWithdrawalsUsdt}
              icon={Banknote}
              showInr
            />
            <AdminStatCard
              label="Total invested"
              amount={adminMetrics.totalInvestedUsdt}
              icon={TrendingUp}
              hint={`${adminMetrics.activeInvestments.toLocaleString("en-IN")} active allocations`}
              showInr
            />
            <AdminStatCard
              label="Profit credited"
              amount={adminMetrics.totalProfitUsdt}
              icon={Coins}
              tone="positive"
              hint="Rewards paid to users"
              showInr
            />
            <AdminStatCard
              label="Referral commissions"
              amount={adminMetrics.referralCommissionsUsdt}
              icon={Gift}
              tone="positive"
              hint="Paid across VIP 1–3"
              showInr
            />
          </AdminStatGrid>
          <RateNote />
        </AdminSection>

        {/* --------------------------------------------------- Charts */}

        <AdminSection title="Trends">
          <div className="grid gap-3 xl:grid-cols-2">
            <PlatformFlowChart
              points={platformFlowWeekly}
              formatValue={(value) => `${formatUsdtCompact(value)} USDT`}
              className="xl:col-span-2"
            />
            <SeriesBarChart
              title="New registrations"
              description="Accounts created per month, last 12 months."
              points={registrationsMonthly}
              formatValue={(value) => value.toLocaleString("en-IN")}
            />
            <TrendChart
              title="Capital allocated"
              description="Total invested across all live plans, at month end."
              points={investedMonthly}
              formatValue={(value) => `${formatUsdtCompact(value)} USDT`}
            />
            <StatusBreakdownBar
              title="Verification pipeline"
              description="Where every account currently sits in KYC."
              segments={[
                {
                  id: "approved",
                  label: "Approved",
                  count: kycPipeline[0].count,
                  color: "bg-chart-1",
                },
                {
                  id: "pending",
                  label: "Pending review",
                  count: kycPipeline[1].count,
                  color: "bg-warning",
                },
                {
                  id: "in_progress",
                  label: "In progress",
                  count: kycPipeline[2].count,
                  color: "bg-info",
                },
                {
                  id: "rejected",
                  label: "Rejected",
                  count: kycPipeline[3].count,
                  color: "bg-destructive",
                },
                {
                  id: "not_started",
                  label: "Not started",
                  count: kycPipeline[4].count,
                  color: "bg-border",
                },
              ]}
            />
            <StatusBreakdownBar
              title="Allocation by plan"
              description="Share of capital currently allocated to each plan, in USDT."
              segments={allocationByPlan.map((entry, index) => ({
                id: entry.label,
                label: entry.label,
                count: entry.value,
                color: PLAN_MIX_COLORS[index] ?? "bg-border",
              }))}
            />
          </div>
        </AdminSection>

        {/* ------------------------------------------------- Activity */}

        <AdminSection title="Recent activity">
          <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
            <RecentRegistrations />
            <RecentKycSubmissions />
            <RecentDeposits />
            <RecentWithdrawals />
            <RecentInvestments />
            <RecentSecurityEvents />
          </div>
        </AdminSection>
      </AdminPage>
    </>
  );
}
