import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock,
  EyeOff,
  Loader2,
  MinusCircle,
  PauseCircle,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type {
  AdminCommissionEntry,
  AdminDepositStatus,
  AdminInvestmentStatus,
  AdminPlanStatus,
  AdminUserStatus,
  AdminWithdrawalStatus,
  AgentStatus,
  AuditLogEntry,
  DeviceSessionStatus,
  KycReviewStatus,
} from "@/types/admin";

/**
 * Status vocabulary for the Master CRM.
 *
 * The same principle as the user app's `StatusBadge`: every status label and
 * colour is defined once, so no screen invents its own wording. This is a
 * separate module because the admin statuses are a different, larger vocabulary
 * — an operator sees `under_review` and `resubmission_requested`, which the user
 * app has no concept of.
 *
 * Meaning is never carried by colour alone: every descriptor pairs an icon with
 * a text label.
 */

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

interface Descriptor {
  label: string;
  variant: BadgeVariant;
  icon: React.ComponentType<{ className?: string }>;
}

const userDescriptors: Record<AdminUserStatus, Descriptor> = {
  active: { label: "Active", variant: "positive", icon: CheckCircle2 },
  inactive: { label: "Inactive", variant: "outline", icon: MinusCircle },
  blocked: { label: "Blocked", variant: "negative", icon: Ban },
  suspended: { label: "Suspended", variant: "warning", icon: PauseCircle },
  deactivated: { label: "Deactivated", variant: "outline", icon: ShieldOff },
};

const kycDescriptors: Record<KycReviewStatus, Descriptor> = {
  pending: { label: "Pending", variant: "warning", icon: Clock },
  under_review: { label: "Under review", variant: "info", icon: Search },
  approved: { label: "Approved", variant: "positive", icon: ShieldCheck },
  rejected: { label: "Rejected", variant: "negative", icon: XCircle },
  resubmission_requested: {
    label: "Resubmission requested",
    variant: "warning",
    icon: RotateCcw,
  },
};

const depositDescriptors: Record<AdminDepositStatus, Descriptor> = {
  pending: { label: "Pending", variant: "warning", icon: Clock },
  detected: { label: "Detected", variant: "info", icon: Search },
  confirming: { label: "Confirming", variant: "info", icon: Loader2 },
  confirmed: { label: "Confirmed", variant: "info", icon: CheckCircle2 },
  credited: { label: "Credited", variant: "positive", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "negative", icon: XCircle },
  ignored: { label: "Ignored", variant: "outline", icon: EyeOff },
};

const withdrawalDescriptors: Record<AdminWithdrawalStatus, Descriptor> = {
  pending: { label: "Pending", variant: "warning", icon: Clock },
  under_review: { label: "Under review", variant: "info", icon: Search },
  approved: { label: "Approved", variant: "info", icon: CheckCircle2 },
  processing: { label: "Processing", variant: "info", icon: Loader2 },
  paid: { label: "Paid", variant: "positive", icon: CheckCircle2 },
  rejected: { label: "Rejected", variant: "negative", icon: XCircle },
  failed: { label: "Failed", variant: "negative", icon: AlertCircle },
};

const investmentDescriptors: Record<AdminInvestmentStatus, Descriptor> = {
  active: { label: "Active", variant: "positive", icon: CheckCircle2 },
  matured: { label: "Matured", variant: "default", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", variant: "outline", icon: XCircle },
};

const planDescriptors: Record<AdminPlanStatus, Descriptor> = {
  open: { label: "Open", variant: "positive", icon: CheckCircle2 },
  limited: { label: "Limited", variant: "warning", icon: AlertCircle },
  closed: { label: "Closed", variant: "outline", icon: MinusCircle },
  disabled: { label: "Disabled", variant: "negative", icon: Ban },
};

const agentDescriptors: Record<AgentStatus, Descriptor> = {
  active: { label: "Active", variant: "positive", icon: CheckCircle2 },
  disabled: { label: "Disabled", variant: "negative", icon: Ban },
  invited: { label: "Invited", variant: "info", icon: Clock },
};

const sessionDescriptors: Record<DeviceSessionStatus, Descriptor> = {
  active: { label: "Active", variant: "positive", icon: CheckCircle2 },
  expired: { label: "Expired", variant: "outline", icon: Clock },
  revoked: { label: "Revoked", variant: "negative", icon: ShieldOff },
};

const commissionDescriptors: Record<
  AdminCommissionEntry["status"],
  Descriptor
> = {
  credited: { label: "Credited", variant: "positive", icon: CheckCircle2 },
  pending: { label: "Pending", variant: "warning", icon: Clock },
  reversed: { label: "Reversed", variant: "negative", icon: RotateCcw },
};

const outcomeDescriptors: Record<AuditLogEntry["outcome"], Descriptor> = {
  success: { label: "Success", variant: "positive", icon: CheckCircle2 },
  failed: { label: "Blocked", variant: "negative", icon: XCircle },
};

export type AdminStatusKind =
  | { kind: "user"; status: AdminUserStatus }
  | { kind: "kyc"; status: KycReviewStatus }
  | { kind: "deposit"; status: AdminDepositStatus }
  | { kind: "withdrawal"; status: AdminWithdrawalStatus }
  | { kind: "investment"; status: AdminInvestmentStatus }
  | { kind: "plan"; status: AdminPlanStatus }
  | { kind: "agent"; status: AgentStatus }
  | { kind: "session"; status: DeviceSessionStatus }
  | { kind: "commission"; status: AdminCommissionEntry["status"] }
  | { kind: "outcome"; status: AuditLogEntry["outcome"] };

function resolve(props: AdminStatusKind): Descriptor {
  switch (props.kind) {
    case "user":
      return userDescriptors[props.status];
    case "kyc":
      return kycDescriptors[props.status];
    case "deposit":
      return depositDescriptors[props.status];
    case "withdrawal":
      return withdrawalDescriptors[props.status];
    case "investment":
      return investmentDescriptors[props.status];
    case "plan":
      return planDescriptors[props.status];
    case "agent":
      return agentDescriptors[props.status];
    case "session":
      return sessionDescriptors[props.status];
    case "commission":
      return commissionDescriptors[props.status];
    case "outcome":
      return outcomeDescriptors[props.status];
  }
}

export function AdminStatusBadge({
  className,
  ...props
}: AdminStatusKind & { className?: string }) {
  const { label, variant, icon: Icon } = resolve(props);
  return (
    <Badge variant={variant} className={className}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  );
}

export function adminStatusLabel(props: AdminStatusKind) {
  return resolve(props).label;
}

/* Named wrappers, so call sites read as the brief describes them. */

export const UserStatusBadge = ({
  status,
  className,
}: {
  status: AdminUserStatus;
  className?: string;
}) => <AdminStatusBadge kind="user" status={status} className={className} />;

export const KycStatusBadge = ({
  status,
  className,
}: {
  status: KycReviewStatus;
  className?: string;
}) => <AdminStatusBadge kind="kyc" status={status} className={className} />;

export const DepositStatusBadge = ({
  status,
  className,
}: {
  status: AdminDepositStatus;
  className?: string;
}) => <AdminStatusBadge kind="deposit" status={status} className={className} />;

export const WithdrawalStatusBadge = ({
  status,
  className,
}: {
  status: AdminWithdrawalStatus;
  className?: string;
}) => (
  <AdminStatusBadge kind="withdrawal" status={status} className={className} />
);
