"use client";

import Link from "next/link";
import {
  ArrowRight,
  Banknote,
  KeyRound,
  LogIn,
  LogOut,
  Lock,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

import { AdminStatusBadge } from "@/components/admin/shared/admin-status-badge";
import {
  ActivityTimeline,
  type TimelineEntry,
} from "@/components/admin/shared/activity-timeline";
import { adminInvestments } from "@/data/admin/investments";
import { recentSecurityEvents } from "@/data/admin/security";
import { formatUsdt } from "@/lib/currency";
import { useAdminStore } from "@/lib/admin-store";
import { cn } from "@/lib/utils";
import type { SecurityEventType } from "@/types/admin";
import { formatDate } from "@/utils/format";

/**
 * The "what just happened" half of the dashboard.
 *
 * Each panel is a short, scannable list with a link to the full queue — the
 * dashboard's job is to tell an operator where to go next, not to be a
 * substitute for the queue itself.
 */

function Panel({
  title,
  href,
  linkLabel,
  children,
  className,
}: {
  title: string;
  href: string;
  linkLabel: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        // `min-w-0`: as a grid child, the default `min-width: auto` would let a
        // long row (a wide status badge next to a long name) widen the track.
        "flex min-w-0 flex-col rounded-2xl border border-border bg-card",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-1 py-1 text-xs font-medium text-brand transition-colors hover:text-brand/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {linkLabel}
          <ArrowRight className="size-3" />
        </Link>
      </header>
      <div className="flex-1 px-4 py-2">{children}</div>
    </section>
  );
}

function Row({
  href,
  title,
  subtitle,
  value,
  meta,
}: {
  href?: string;
  title: string;
  subtitle: string;
  value?: React.ReactNode;
  meta?: React.ReactNode;
}) {
  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="tabular block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {value ? (
          <span className="tabular text-sm font-medium">{value}</span>
        ) : null}
        {meta}
      </span>
    </>
  );

  const className =
    "flex w-full items-center gap-3 py-2.5 text-left transition-colors";

  if (href) {
    return (
      <li className="border-b border-border last:border-0">
        <Link
          href={href}
          className={cn(
            className,
            "rounded-lg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring hover:opacity-80",
          )}
        >
          {body}
        </Link>
      </li>
    );
  }

  return (
    <li className="border-b border-border last:border-0">
      <div className={className}>{body}</div>
    </li>
  );
}

export function RecentRegistrations() {
  const { users } = useAdminStore();
  const rows = [...users]
    .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))
    .slice(0, 5);

  return (
    <Panel title="Recent registrations" href="/admin/users" linkLabel="All users">
      <ul>
        {rows.map((user) => (
          <Row
            key={user.id}
            href={`/admin/users/${user.id}`}
            title={user.fullName}
            subtitle={`${user.displayId} · ${formatDate(user.registeredAt)}`}
            meta={<AdminStatusBadge kind="kyc" status={kycToReview(user.kycStatus)} />}
          />
        ))}
      </ul>
    </Panel>
  );
}

/** Maps the user-facing KYC status onto the reviewer's vocabulary. */
function kycToReview(status: string) {
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

export function RecentDeposits() {
  const { deposits } = useAdminStore();
  const rows = [...deposits]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

  return (
    <Panel title="Recent deposits" href="/admin/deposits" linkLabel="All deposits">
      <ul>
        {rows.map((deposit) => (
          <Row
            key={deposit.id}
            title={deposit.userName}
            subtitle={`${deposit.id} · ${formatDate(deposit.createdAt)}`}
            value={formatUsdt(deposit.amountUsdt, { withSymbol: false })}
            meta={<AdminStatusBadge kind="deposit" status={deposit.status} />}
          />
        ))}
      </ul>
    </Panel>
  );
}

export function RecentWithdrawals() {
  const { withdrawals } = useAdminStore();
  const rows = [...withdrawals]
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
    .slice(0, 5);

  return (
    <Panel
      title="Recent withdrawals"
      href="/admin/withdrawals"
      linkLabel="All withdrawals"
    >
      <ul>
        {rows.map((withdrawal) => (
          <Row
            key={withdrawal.id}
            title={withdrawal.userName}
            subtitle={`${withdrawal.id} · ${formatDate(withdrawal.requestedAt)}`}
            value={formatUsdt(withdrawal.amountUsdt, { withSymbol: false })}
            meta={
              <AdminStatusBadge kind="withdrawal" status={withdrawal.status} />
            }
          />
        ))}
      </ul>
    </Panel>
  );
}

export function RecentKycSubmissions() {
  const { kyc } = useAdminStore();
  const rows = [...kyc]
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
    .slice(0, 5);

  return (
    <Panel title="Recent KYC submissions" href="/admin/kyc" linkLabel="Review queue">
      <ul>
        {rows.map((submission) => (
          <Row
            key={submission.id}
            href={`/admin/users/${submission.userId}`}
            title={submission.userName}
            subtitle={`${submission.userDisplayId} · ${formatDate(submission.submittedAt)}`}
            meta={<AdminStatusBadge kind="kyc" status={submission.status} />}
          />
        ))}
      </ul>
    </Panel>
  );
}

export function RecentInvestments() {
  const rows = [...adminInvestments]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 5);

  return (
    <Panel
      title="Recent investments"
      href="/admin/investments"
      linkLabel="All investments"
    >
      <ul>
        {rows.map((investment) => (
          <Row
            key={investment.id}
            href={`/admin/users/${investment.userId}`}
            title={investment.userName}
            subtitle={`${investment.planName} · ${formatDate(investment.startedAt)}`}
            value={formatUsdt(investment.amountUsdt, { withSymbol: false })}
            meta={
              <AdminStatusBadge kind="investment" status={investment.status} />
            }
          />
        ))}
      </ul>
    </Panel>
  );
}

const SECURITY_ICONS: Record<SecurityEventType, LucideIcon> = {
  login: LogIn,
  failed_login: ShieldAlert,
  password_changed: KeyRound,
  two_factor_changed: ShieldCheck,
  account_locked: Lock,
  device_logged_out: LogOut,
  withdrawal_address_added: Banknote,
};

export function RecentSecurityEvents() {
  const entries: TimelineEntry[] = recentSecurityEvents.slice(0, 6).map((event) => ({
    id: event.id,
    title: event.description,
    timestamp: event.createdAt,
    icon: SECURITY_ICONS[event.type],
    tone: event.outcome === "blocked" ? "negative" : "default",
    meta: `${event.device} · ${event.ipAddress} · ${event.location}`,
  }));

  return (
    <Panel
      title="Recent security events"
      href="/admin/audit-logs"
      linkLabel="Audit logs"
    >
      <div className="py-2">
        <ActivityTimeline entries={entries} />
      </div>
    </Panel>
  );
}

