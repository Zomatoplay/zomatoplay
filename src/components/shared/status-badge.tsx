import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { AdminDepositStatus } from "@/types/admin";
import type {
  DepositRequestStatus,
  InvestmentStatus,
  KycStatus,
  PlanStatus,
  ReferralStatus,
  TransactionStatus,
} from "@/types";

type BadgeVariant = React.ComponentProps<typeof Badge>["variant"];

interface Descriptor {
  label: string;
  variant: BadgeVariant;
  icon?: React.ComponentType<{ className?: string }>;
}

const transactionDescriptors: Record<TransactionStatus, Descriptor> = {
  completed: { label: "Completed", variant: "positive", icon: CheckCircle2 },
  pending: { label: "Pending", variant: "warning", icon: Clock },
  processing: { label: "Processing", variant: "info", icon: Loader2 },
  failed: { label: "Failed", variant: "negative", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "outline", icon: XCircle },
};

const investmentDescriptors: Record<InvestmentStatus, Descriptor> = {
  active: { label: "Active", variant: "positive" },
  completed: { label: "Matured", variant: "default" },
  cancelled: { label: "Cancelled", variant: "outline" },
};

const planDescriptors: Record<PlanStatus, Descriptor> = {
  open: { label: "Open", variant: "positive" },
  limited: { label: "Limited capacity", variant: "warning" },
  closed: { label: "Closed", variant: "outline" },
};

const kycDescriptors: Record<KycStatus, Descriptor> = {
  not_started: { label: "Not started", variant: "warning", icon: AlertCircle },
  in_progress: { label: "In progress", variant: "info", icon: Clock },
  pending_review: { label: "Under review", variant: "info", icon: Clock },
  verified: { label: "Verified", variant: "positive", icon: ShieldCheck },
  rejected: { label: "Action needed", variant: "negative", icon: XCircle },
};

/**
 * A deposit, as the person who sent it reads it.
 *
 * The same seven states the CRM shows, worded for the sender rather than for
 * an operator: "credited" is the moment the money is theirs, and "ignored" —
 * an operator's judgement that a transfer was not a platform deposit — is
 * stated as its consequence rather than as the internal decision.
 */
const depositDescriptors: Record<AdminDepositStatus, Descriptor> = {
  pending: { label: "Pending", variant: "warning", icon: Clock },
  detected: { label: "Detected", variant: "info", icon: Loader2 },
  confirming: { label: "Confirming", variant: "info", icon: Loader2 },
  confirmed: { label: "Confirmed", variant: "info", icon: CheckCircle2 },
  credited: { label: "Credited", variant: "positive", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "negative", icon: XCircle },
  ignored: { label: "Not credited", variant: "outline", icon: AlertCircle },
};

/**
 * "Credited" only ever describes a request the server has credited after
 * verifying the transfer on-chain — there is no "payment successful" state
 * before that.
 */
const depositRequestDescriptors: Record<DepositRequestStatus, Descriptor> = {
  awaiting_payment: { label: "Waiting for payment", variant: "warning", icon: Clock },
  verifying: { label: "Waiting for verification", variant: "info", icon: Loader2 },
  credited: { label: "Credited", variant: "positive", icon: CheckCircle2 },
  needs_review: { label: "Under review", variant: "info", icon: AlertCircle },
  expired: { label: "Expired", variant: "outline", icon: Clock },
  rejected: { label: "Not credited", variant: "negative", icon: XCircle },
  cancelled: { label: "Cancelled", variant: "outline", icon: XCircle },
};

const referralDescriptors: Record<ReferralStatus, Descriptor> = {
  active: { label: "Active", variant: "positive" },
  registered: { label: "Registered", variant: "info" },
  inactive: { label: "Inactive", variant: "outline" },
};

export type StatusKind =
  | { kind: "transaction"; status: TransactionStatus }
  | { kind: "investment"; status: InvestmentStatus }
  | { kind: "plan"; status: PlanStatus }
  | { kind: "kyc"; status: KycStatus }
  | { kind: "referral"; status: ReferralStatus }
  | { kind: "deposit"; status: AdminDepositStatus }
  | { kind: "depositRequest"; status: DepositRequestStatus };

function resolve(props: StatusKind): Descriptor {
  switch (props.kind) {
    case "transaction":
      return transactionDescriptors[props.status];
    case "investment":
      return investmentDescriptors[props.status];
    case "plan":
      return planDescriptors[props.status];
    case "kyc":
      return kycDescriptors[props.status];
    case "referral":
      return referralDescriptors[props.status];
    case "deposit":
      return depositDescriptors[props.status];
    case "depositRequest":
      return depositRequestDescriptors[props.status];
  }
}

/**
 * Renders the correct label, colour and icon for any domain status, so status
 * vocabulary stays consistent across every screen.
 */
export function StatusBadge({
  className,
  showIcon = true,
  ...props
}: StatusKind & { className?: string; showIcon?: boolean }) {
  const descriptor = resolve(props);
  const Icon = descriptor.icon;
  return (
    <Badge variant={descriptor.variant} className={className}>
      {showIcon && Icon ? <Icon className="size-3" aria-hidden /> : null}
      {descriptor.label}
    </Badge>
  );
}

export function statusLabel(props: StatusKind) {
  return resolve(props).label;
}
