/**
 * Domain types for the Nanotron Master CRM.
 *
 * These extend — never replace — the user-facing domain in `@/types`. Where a
 * concept already exists there (KycStatus, RiskLevel, VipLevelId, …) it is
 * imported and reused so both applications speak about the same records.
 *
 * As with the user app, every shape here is modelled on the payload a real
 * admin API would return, so the mock modules in `@/data/admin` can be swapped
 * for fetch calls without touching component code. All monetary amounts are
 * USDT unless a field name says otherwise; INR is always derived at render time
 * through `@/lib/currency`.
 */

import type {
  DepositNetworkId,
  KycStatus,
  RewardFrequency,
  RiskLevel,
  VipLevelId,
} from "@/types";

/* -------------------------------------------------------------------------- */
/* Roles & permissions                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Two conceptual roles. A master admin implicitly holds `manage` on every
 * permission; an agent holds exactly what has been assigned to them.
 */
export type AdminRole = "master_admin" | "agent";

/** The permission surface. One entry per governable area of the CRM. */
export type AdminPermissionId =
  | "users"
  | "user_details"
  | "kyc"
  | "deposits"
  | "withdrawals"
  | "investments"
  | "plans"
  | "referrals"
  | "notifications"
  | "audit_logs"
  | "settings"
  | "security"
  | "agents";

/**
 * Graded rather than boolean: most real operations teams need a read-only tier
 * (support staff who look but cannot approve) distinct from an operator tier.
 */
export type AdminPermissionLevel = "none" | "view" | "manage";

export type AdminPermissionSet = Record<AdminPermissionId, AdminPermissionLevel>;

export interface AdminPermissionDescriptor {
  id: AdminPermissionId;
  label: string;
  description: string;
  /** What `manage` additionally unlocks, shown in the permission matrix. */
  manageHint: string;
}

/* -------------------------------------------------------------------------- */
/* Agents                                                                      */
/* -------------------------------------------------------------------------- */

export type AgentStatus = "active" | "disabled" | "invited";

export interface AdminAgent {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
  status: AgentStatus;
  createdAt: string;
  /** ISO timestamp of last activity, or null if never signed in. */
  lastActiveAt: string | null;
  permissions: AdminPermissionSet;
  /** Free-text note for the operations team. */
  note?: string;
  /** Set when a password reset has been issued but not yet completed. */
  passwordResetRequestedAt?: string | null;
}

/**
 * The signed-in operator. No real authentication exists yet — this is selected
 * from a demo control in the admin header.
 *
 * INTEGRATION POINT: replace with the real session principal.
 */
export interface AdminSession {
  agentId: string;
  name: string;
  email: string;
  role: AdminRole;
  permissions: AdminPermissionSet;
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export type AdminUserStatus =
  | "active"
  | "inactive"
  | "blocked"
  | "suspended"
  | "deactivated";

/** Independently togglable holds, so support can freeze one rail at a time. */
export interface AdminUserRestrictions {
  accountFrozen: boolean;
  withdrawalsFrozen: boolean;
  investmentsFrozen: boolean;
}

export interface AdminUserTotals {
  availableUsdt: number;
  lockedUsdt: number;
  totalDeposited: number;
  totalInvested: number;
  totalProfit: number;
  totalWithdrawn: number;
}

export interface AdminUser {
  id: string;
  /** Public-facing member id, the one support asks for on a call. */
  displayId: string;
  fullName: string;
  email: string;
  phone: string;
  country: string;
  registeredAt: string;
  lastActiveAt: string;
  status: AdminUserStatus;
  kycStatus: KycStatus;
  vipLevel: VipLevelId;
  referralCode: string;
  /** Code of the user who referred this one, if any. */
  referredByCode: string | null;
  referralCount: number;
  /** Primary deposit wallet address on file — searchable. */
  walletAddress: string;
  totals: AdminUserTotals;
  restrictions: AdminUserRestrictions;
  twoFactorEnabled: boolean;
  /** Internal-only note, never shown to the user. */
  internalNote?: string;
}

/* -------------------------------------------------------------------------- */
/* KYC review                                                                  */
/* -------------------------------------------------------------------------- */

export type KycReviewStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "rejected"
  | "resubmission_requested";

export type KycDocumentType = "passport" | "national_id" | "driving_licence";

export interface KycDocument {
  id: string;
  label: string;
  type: KycDocumentType;
  fileName: string;
  /**
   * Whether an actual object exists in the private bucket for this row.
   *
   * The key itself is deliberately **not** carried to the browser. It is not a
   * secret — the storage policies, not obscurity, are what stop somebody
   * reading another account's folder — but there is no reason for it to be in a
   * page, and an operator opens a document through a server action that mints a
   * short-lived signed URL instead. Rows written before storage existed have
   * `false` here, and the CRM says "no file" rather than offering a dead link.
   */
  hasFile: boolean;
  uploadedAt: string;
  pages: number;
}

export interface KycInternalNote {
  id: string;
  author: string;
  body: string;
  createdAt: string;
}

export interface KycSubmission {
  id: string;
  userId: string;
  userName: string;
  userDisplayId: string;
  submittedAt: string;
  status: KycReviewStatus;
  /** Declared verification details captured during the user's KYC flow. */
  details: {
    legalName: string;
    dateOfBirth: string;
    nationality: string;
    address: string;
    documentType: KycDocumentType;
    documentNumberMasked: string;
  };
  documents: KycDocument[];
  livenessCheckPassed: boolean;
  /** Agent id + name of the reviewer, once a decision has been taken. */
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  notes: KycInternalNote[];
  /** Automated risk signals a provider would return. */
  riskFlags: string[];
}

/* -------------------------------------------------------------------------- */
/* Deposits                                                                    */
/* -------------------------------------------------------------------------- */

export type AdminDepositStatus =
  | "pending"
  | "detected"
  | "confirming"
  | "confirmed"
  | "credited"
  | "failed"
  /** Seen on-chain, and an operator decided it is not a platform deposit. */
  | "ignored";

/** Whether the chain data has been checked against the configured policy. */
export type DepositVerification = "unverified" | "verified" | "rejected";

export type ChainId = "tron";
export type ChainNetwork = "mainnet" | "shasta" | "nile";

export interface AdminDeposit {
  id: string;
  /**
   * Null until an operator attributes the transfer to an account.
   *
   * One platform address receives every deposit, and a TRC-20 transfer carries
   * no account identifier — so an incoming transfer belongs to nobody until
   * somebody says which account it is for. See the note on the `deposits` table.
   */
  userId: string | null;
  /** "Unassigned" when there is no `userId`. */
  userName: string;
  userDisplayId: string;
  assignedAt: string | null;
  assignedBy: string | null;
  amountUsdt: number;
  network: DepositNetworkId;
  chain: ChainId;
  chainNetwork: ChainNetwork;
  /** The token contract the transfer was made in. */
  tokenContract: string | null;
  tokenSymbol: string | null;
  /** Where the funds came from. Never treated as an identity. */
  senderAddress: string | null;
  /** The platform address that received them. */
  walletAddress: string;
  txHash: string;
  blockNumber: string | null;
  blockTimestamp: string | null;
  createdAt: string;
  detectedAt: string | null;
  confirmedAt: string | null;
  creditedAt: string | null;
  confirmations: { current: number; required: number };
  status: AdminDepositStatus;
  verification: DepositVerification;
  failureReason?: string;
}

/* -------------------------------------------------------------------------- */
/* Withdrawals                                                                 */
/* -------------------------------------------------------------------------- */

export type AdminWithdrawalStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "processing"
  | "paid"
  | "rejected"
  | "failed";

export interface AdminWithdrawal {
  id: string;
  userId: string;
  userName: string;
  userDisplayId: string;
  amountUsdt: number;
  /** Quoted payout rate at request time — distinct from the display rate. */
  payoutRate: number;
  flatFeeUsdt: number;
  percentFeeUsdt: number;
  totalFeeUsdt: number;
  /** INR actually payable after fees, at the quoted rate. */
  netInr: number;
  destination: {
    label: string;
    bankName: string;
    accountNumberMasked: string;
    ifsc: string;
    holderName: string;
  };
  requestedAt: string;
  settledAt: string | null;
  status: AdminWithdrawalStatus;
  reviewedBy: string | null;
  rejectionReason: string | null;
  /** Payout rail reference once processing has started. */
  payoutReference: string | null;
}

/* -------------------------------------------------------------------------- */
/* Investments                                                                 */
/* -------------------------------------------------------------------------- */

export type AdminInvestmentStatus = "active" | "matured" | "cancelled";

export interface AdminInvestment {
  id: string;
  userId: string;
  userName: string;
  userDisplayId: string;
  planId: string;
  planName: string;
  amountUsdt: number;
  /** Profit credited so far. Never presented as guaranteed. */
  profitUsdt: number;
  projectedProfitUsdt: number;
  startedAt: string;
  maturesAt: string;
  durationDays: number;
  elapsedDays: number;
  rewardFrequency: RewardFrequency;
  nextRewardAt: string | null;
  nextRewardAmount: number | null;
  risk: RiskLevel;
  status: AdminInvestmentStatus;
}

/* -------------------------------------------------------------------------- */
/* Plan administration                                                         */
/* -------------------------------------------------------------------------- */

export type AdminPlanStatus = "open" | "limited" | "closed" | "disabled";

/**
 * The editable projection of a plan. Deliberately narrower than the public
 * `Plan` type: marketing copy blocks (`howItWorks`, `conditions`, `riskNotes`)
 * stay in the catalogue, while the commercial parameters an operator changes
 * live here.
 */
export interface AdminPlan {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  minInvestment: number;
  maxInvestment: number;
  /** 0 means an open-ended plan with no lock-in. */
  durationDays: number;
  /** Projected total return over the term. Always shown as an estimate. */
  estimatedReturnPercent: number;
  estimatedReturnRange: [number, number];
  rewardFrequency: RewardFrequency;
  risk: RiskLevel;
  status: AdminPlanStatus;
  capacityFilledPercent?: number;
  /** Live figures a real products service would compute. */
  stats: {
    activeInvestments: number;
    totalAllocated: number;
    totalProfitPaid: number;
  };
  updatedAt: string;
}

/* -------------------------------------------------------------------------- */
/* Referrals                                                                   */
/* -------------------------------------------------------------------------- */

export interface AdminReferralAccount {
  userId: string;
  userName: string;
  userDisplayId: string;
  referralCode: string;
  vipLevel: VipLevelId;
  /** Direct (tier 1) referrals. */
  directReferrals: number;
  /** Second-tier referrals. */
  indirectReferrals: number;
  activeReferrals: number;
  teamVolumeUsdt: number;
  commissionEarnedUsdt: number;
  commissionPendingUsdt: number;
  joinedAt: string;
}

export interface AdminCommissionEntry {
  id: string;
  /** Who was paid. */
  beneficiaryUserId: string;
  beneficiaryName: string;
  /** Whose allocation generated it. */
  sourceUserName: string;
  tier: 1 | 2;
  amountUsdt: number;
  sourcePlanName: string;
  createdAt: string;
  status: "credited" | "pending" | "reversed";
}

/* -------------------------------------------------------------------------- */
/* Devices, sessions & security                                                */
/* -------------------------------------------------------------------------- */

export type DeviceSessionStatus = "active" | "expired" | "revoked";

export interface UserDeviceSession {
  id: string;
  userId: string;
  device: string;
  browser: string;
  os: string;
  ipAddress: string;
  location: string;
  loggedInAt: string;
  lastActiveAt: string;
  status: DeviceSessionStatus;
  /** The session the user is currently browsing from. */
  current: boolean;
}

export type SecurityEventType =
  | "login"
  | "failed_login"
  | "password_changed"
  | "two_factor_changed"
  | "account_locked"
  | "device_logged_out"
  | "withdrawal_address_added";

export interface UserSecurityEvent {
  id: string;
  userId: string;
  type: SecurityEventType;
  description: string;
  device: string;
  ipAddress: string;
  location: string;
  createdAt: string;
  outcome: "success" | "blocked";
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every mutating action in the CRM appends one of these. The action ids are
 * deliberately explicit rather than free text so they stay filterable and
 * translatable.
 */
export type AuditAction =
  | "kyc_approved"
  | "kyc_rejected"
  | "kyc_resubmission_requested"
  | "kyc_note_added"
  | "user_blocked"
  | "user_unblocked"
  | "user_suspended"
  | "user_deactivated"
  | "user_updated"
  | "user_password_reset"
  | "user_two_factor_reset"
  | "user_restriction_changed"
  | "device_logged_out"
  | "all_devices_logged_out"
  | "deposit_credited"
  | "deposit_failed"
  | "withdrawal_approved"
  | "withdrawal_rejected"
  | "withdrawal_marked_paid"
  | "plan_created"
  | "plan_updated"
  | "plan_disabled"
  | "plan_enabled"
  | "agent_created"
  | "agent_updated"
  | "agent_disabled"
  | "agent_enabled"
  | "agent_password_reset"
  | "agent_permissions_changed"
  | "notification_sent"
  | "settings_updated";

/**
 * A step the system took, with how long it took and how it went.
 *
 * Distinct from `AuditLogEntry`, which records *who decided what*. This records
 * what the machinery did — a Supabase call, a transaction, a TronGrid page —
 * so a failed click can be traced instead of guessed at. See the table comment
 * in `db/schema/observability.ts`.
 */
export type PipelineId =
  | "navigation"
  | "auth"
  | "kyc"
  | "deposit"
  | "chain_scanner"
  | "investment"
  | "withdrawal"
  | "email"
  | "database"
  | "admin";

export type PipelineStatus = "started" | "ok" | "failed";

export type PipelineLayer =
  | "client"
  | "server"
  | "database"
  | "external"
  | "blockchain";

export type PipelineActorType = "user" | "admin" | "system";

export interface PipelineEvent {
  id: string;
  pipeline: PipelineId;
  layer: PipelineLayer;
  /** The route the request was for, e.g. `/wallet`. */
  route: string | null;
  actorType: PipelineActorType;
  /** `area.verb`, e.g. `kyc.submit`. */
  operation: string;
  status: PipelineStatus;
  occurredAt: string;
  durationMs: number | null;
  /** Ties every step of one request together. */
  correlationId: string;
  userId: string | null;
  /** Resolved for display; the row stores only the id. */
  userLabel: string | null;
  actorId: string | null;
  actorName: string | null;
  subjectType: string | null;
  subjectId: string | null;
  message: string;
  errorMessage: string | null;
  metadata: Record<string, string | number | boolean> | null;
}

export interface AuditLogEntry {
  id: string;
  /** Operator who performed the action. */
  actorId: string;
  actorName: string;
  actorRole: AdminRole;
  action: AuditAction;
  /** Subject of the action — a user, agent, plan, deposit, … */
  target: {
    type:
      | "user"
      | "agent"
      | "plan"
      | "deposit"
      | "withdrawal"
      | "kyc"
      | "notification"
      | "settings";
    id: string;
    label: string;
  } | null;
  createdAt: string;
  ipAddress: string;
  outcome: "success" | "failed";
  /** Human-readable summary of what changed. */
  details: string;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export type AdminNotificationChannel = "in_app" | "email" | "push";

export type AdminNotificationAudience =
  | "single_user"
  | "all_users"
  | "kyc_pending"
  | "kyc_approved"
  | "active_investors"
  | "inactive_users"
  | "vip"
  | "blocked_users";

export type AdminNotificationTemplateId =
  | "announcement"
  | "kyc_reminder"
  | "deposit_credited"
  | "withdrawal_processed"
  | "investment_matured"
  | "custom";

export interface AdminNotificationTemplate {
  id: AdminNotificationTemplateId;
  label: string;
  description: string;
  title: string;
  body: string;
  /** Suggested audience — the operator can still change it. */
  defaultAudience: AdminNotificationAudience;
}

export interface AdminNotificationCampaign {
  id: string;
  title: string;
  body: string;
  audience: AdminNotificationAudience;
  /** Present only when `audience` is `single_user`. */
  targetUserLabel: string | null;
  channels: AdminNotificationChannel[];
  templateId: AdminNotificationTemplateId;
  sentAt: string;
  sentBy: string;
  recipientCount: number;
  status: "sent" | "scheduled" | "failed";
}

/* -------------------------------------------------------------------------- */
/* Platform settings                                                           */
/* -------------------------------------------------------------------------- */

export interface PlatformSettings {
  platform: {
    name: string;
    tagline: string;
    supportEmail: string;
    supportHours: string;
    /** Puts the user application into a read-only state. Prototype flag only. */
    maintenanceMode: boolean;
    registrationsOpen: boolean;
  };
  currency: {
    /** USDT→INR rate used for approximate display figures. */
    displayRate: number;
    /** Rate quoted when an INR withdrawal is priced. */
    payoutRate: number;
    rateLabel: string;
  };
  withdrawals: {
    minimumUsdt: number;
    flatFeeUsdt: number;
    percentFee: number;
    processingWindow: string;
    /** Above this, a withdrawal always needs a second reviewer. */
    manualReviewThresholdUsdt: number;
    requireKyc: boolean;
  };
  deposits: {
    minimumUsdt: number;
    autoCreditEnabled: boolean;
  };
  investments: {
    requireKyc: boolean;
    maxActivePerUser: number;
    allowEarlyExit: boolean;
  };
  referrals: {
    programmeEnabled: boolean;
    /** Commission percentages and thresholds stay in `@/data/referrals`. */
    payoutDelayDays: number;
    maxTiers: 1 | 2;
  };
  security: {
    requireTwoFactorForAgents: boolean;
    sessionTimeoutMinutes: number;
    maxFailedLogins: number;
    ipAllowlistEnabled: boolean;
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard metrics                                                           */
/* -------------------------------------------------------------------------- */

export interface AdminMetrics {
  totalUsers: number;
  activeUsers: number;
  newUsersThisMonth: number;
  blockedUsers: number;
  kycPending: number;
  kycApproved: number;
  kycRejected: number;
  totalDepositsUsdt: number;
  pendingDeposits: number;
  pendingDepositsUsdt: number;
  totalWithdrawalsUsdt: number;
  pendingWithdrawals: number;
  pendingWithdrawalsUsdt: number;
  totalInvestedUsdt: number;
  activeInvestments: number;
  totalProfitUsdt: number;
  referralCommissionsUsdt: number;
}

/** One point on a dated series. */
export interface AdminSeriesPoint {
  label: string;
  value: number;
}

/** One point on a two-direction flow series (money in vs money out). */
export interface AdminFlowPoint {
  label: string;
  inbound: number;
  outbound: number;
}
