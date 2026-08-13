"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, PencilLine } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { UserActionMenu } from "@/components/admin/shared/user-action-menu";
import {
  ActivityPanel,
  DepositsPanel,
  InvestmentsPanel,
  KycPanel,
  OverviewPanel,
  ReferralsPanel,
  RewardsPanel,
  SecurityPanel,
  SessionsPanel,
  UserEditDialog,
  WithdrawalsPanel,
} from "@/components/admin/users/user-detail-panels";
import { RateNote } from "@/components/shared/notices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { formatUsdt, formatUsdtAsInr } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { initials } from "@/utils/format";

/**
 * A single user's full profile.
 *
 * The record is read from the store by id rather than passed in, so every panel
 * — and every action taken from any of them — sees the same live object.
 */

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "investments", label: "Investments" },
  { value: "deposits", label: "Deposits" },
  { value: "withdrawals", label: "Withdrawals" },
  { value: "rewards", label: "Profits" },
  { value: "referrals", label: "Referrals" },
  { value: "kyc", label: "KYC" },
  { value: "sessions", label: "Devices" },
  { value: "security", label: "Security" },
  { value: "activity", label: "Activity" },
] as const;

export function UserDetailView({ userId }: { userId: string }) {
  return (
    <PermissionGate permission="user_details">
      <UserDetail userId={userId} />
    </PermissionGate>
  );
}

function UserDetail({ userId }: { userId: string }) {
  const { users, session } = useAdminStore();
  const [editing, setEditing] = useState(false);
  const user = users.find((candidate) => candidate.id === userId);

  if (!user) {
    // Only reachable if a record disappears from the store mid-session; the
    // route itself 404s for unknown ids before rendering.
    return (
      <AdminPage>
        <p className="py-12 text-center text-sm text-muted-foreground">
          This user is no longer available.
        </p>
      </AdminPage>
    );
  }

  const canEdit = canManage(session, "user_details");

  const totals = [
    { label: "Available", value: user.totals.availableUsdt, tone: "default" },
    { label: "Locked in plans", value: user.totals.lockedUsdt, tone: "default" },
    { label: "Deposited", value: user.totals.totalDeposited, tone: "default" },
    { label: "Invested", value: user.totals.totalInvested, tone: "default" },
    { label: "Profit", value: user.totals.totalProfit, tone: "positive" },
    { label: "Withdrawn", value: user.totals.totalWithdrawn, tone: "default" },
  ] as const;

  return (
    <>
      <AdminHeader
        title={user.fullName}
        description={`${user.displayId} · ${user.email}`}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={!canEdit}
              onClick={() => setEditing(true)}
            >
              <PencilLine className="size-4" />
              Edit user
            </Button>
            <UserActionMenu user={user} variant="button" />
          </>
        }
      />

      <AdminPage className="space-y-5">
        <Link
          href="/admin/users"
          className="inline-flex items-center gap-1 rounded-full py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft className="size-4" />
          All users
        </Link>

        {/* ------------------------------------------------ Identity */}

        <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-soft text-lg font-semibold text-brand">
              {initials(user.fullName)}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold tracking-tight">
                {user.fullName}
              </h2>
              <p className="tabular text-sm text-muted-foreground">
                {user.displayId} · {user.country}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <AdminStatusBadge kind="user" status={user.status} />
                <AdminStatusBadge kind="kyc" status={reviewStatus(user.kycStatus)} />
                <Badge variant="outline">
                  {user.vipLevel.replace("vip", "VIP ")}
                </Badge>
                {user.restrictions.accountFrozen ? (
                  <Badge variant="negative">Account frozen</Badge>
                ) : null}
                {user.restrictions.withdrawalsFrozen ? (
                  <Badge variant="negative">Withdrawals frozen</Badge>
                ) : null}
                {user.restrictions.investmentsFrozen ? (
                  <Badge variant="negative">Investments frozen</Badge>
                ) : null}
              </div>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border pt-4 sm:grid-cols-3 xl:grid-cols-6">
            {totals.map((total) => (
              <div key={total.label} className="min-w-0">
                <dt className="text-xs font-medium text-muted-foreground">
                  {total.label}
                </dt>
                <dd
                  className={cn(
                    "tabular mt-1 text-base font-semibold tracking-tight",
                    total.tone === "positive" ? "text-positive" : "text-foreground",
                  )}
                >
                  {formatUsdt(total.value, { withSymbol: false })}
                  <span className="ml-1 text-[11px] font-medium text-muted-foreground">
                    USDT
                  </span>
                </dd>
                <dd className="tabular text-xs text-muted-foreground">
                  {formatUsdtAsInr(total.value)}
                </dd>
              </div>
            ))}
          </dl>

          <RateNote className="mt-4" />
        </section>

        {/* ---------------------------------------------------- Tabs */}

        <Tabs defaultValue="overview">
          {/* Ten tabs will not fit on a phone, so the list scrolls inside its
              own container rather than compressing or wrapping. */}
          <TabsList className="h-auto w-full justify-start overflow-x-auto no-scrollbar">
            {TABS.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex-none px-3.5"
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview">
            <OverviewPanel user={user} />
          </TabsContent>
          <TabsContent value="investments">
            <InvestmentsPanel user={user} />
          </TabsContent>
          <TabsContent value="deposits">
            <DepositsPanel user={user} />
          </TabsContent>
          <TabsContent value="withdrawals">
            <WithdrawalsPanel user={user} />
          </TabsContent>
          <TabsContent value="rewards">
            <RewardsPanel user={user} />
          </TabsContent>
          <TabsContent value="referrals">
            <ReferralsPanel user={user} />
          </TabsContent>
          <TabsContent value="kyc">
            <KycPanel user={user} />
          </TabsContent>
          <TabsContent value="sessions">
            <SessionsPanel user={user} />
          </TabsContent>
          <TabsContent value="security">
            <SecurityPanel user={user} />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityPanel user={user} />
          </TabsContent>
        </Tabs>
      </AdminPage>

      <UserEditDialog user={user} open={editing} onOpenChange={setEditing} />
    </>
  );
}

/** The reviewer's status vocabulary, derived from the user's KYC state. */
function reviewStatus(status: string) {
  switch (status) {
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
