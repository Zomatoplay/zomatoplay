"use client";

import { BadgeCheck, Ban, Banknote, Wallet } from "lucide-react";

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
  AdminStatCard,
  AdminStatGrid,
} from "@/components/admin/shared/admin-stat-card";
import { formatUsdt } from "@/lib/currency";
import type { AdminDashboardMetrics } from "@/types/admin";

/**
 * The CRM's landing screen: the queues that need attention and six "what just
 * happened" panels.
 *
 * The queue counts are **counted in SQL** (`readDashboardMetrics`) and arrive
 * as a prop, so crediting a deposit or approving a withdrawal is reflected here
 * on the next render. They used to be derived in this component from four
 * whole platform tables the page had fetched for the purpose.
 *
 * The platform-wide totals and the four trend charts that used to sit here
 * read fixtures from `@/data/admin/metrics`, not the database. They were
 * removed for the production launch rather than shown unlabelled: a deposit
 * total nobody computed is worse on an operations screen than no total.
 * Bringing them back needs a reporting service with real aggregates (M2 in
 * `FUTURE_TASKS.md`), and `admin-charts` is kept for it.
 */
export function DashboardView({ metrics }: { metrics: AdminDashboardMetrics }) {
  /*
   * The queue figures arrive already counted.
   *
   * They used to be derived here with `filter` and `reduce` over four full
   * platform tables the page had fetched for the purpose. The predicates moved
   * into SQL unchanged — see `readDashboardMetrics` — so the numbers are the
   * same ones, counted where the rows already are.
   *
   * The store slices below are now five-row "recent activity" windows, and the
   * panels that read them sort and slice their own, so they are unaffected.
   */

  return (
    <>
      <AdminHeader
        title="Dashboard"
        description="Open queues and recent activity."
      />

      <AdminPage className="space-y-6">
        {/* -------------------------------------------------- Queues */}

        <AdminSection
          title="Needs attention"
          description="Open queues, counted from the database."
        >
          <AdminStatGrid className="xl:grid-cols-4">
            <AdminStatCard
              label="KYC awaiting review"
              value={metrics.kycPending}
              icon={BadgeCheck}
              tone={metrics.kycPending > 0 ? "warning" : "default"}
              hint="Pending and under review"
              href="/admin/kyc"
            />
            <AdminStatCard
              label="Deposits not yet credited"
              value={metrics.depositsPending}
              icon={Wallet}
              tone={metrics.depositsPending > 0 ? "warning" : "default"}
              hint={`${formatUsdt(metrics.depositsPendingUsdt, { withSymbol: false })} USDT in flight`}
              href="/admin/deposits"
            />
            <AdminStatCard
              label="Withdrawals in progress"
              value={metrics.withdrawalsPending}
              icon={Banknote}
              tone={metrics.withdrawalsPending > 0 ? "warning" : "default"}
              hint={`${formatUsdt(metrics.withdrawalsPendingUsdt, { withSymbol: false })} USDT to pay out`}
              href="/admin/withdrawals"
            />
            <AdminStatCard
              label="Blocked or suspended"
              value={metrics.usersRestricted}
              icon={Ban}
              tone={metrics.usersRestricted > 0 ? "negative" : "default"}
              hint="Accounts under a restriction"
              href="/admin/users"
            />
          </AdminStatGrid>
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
