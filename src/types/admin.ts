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
  | "agents"
  /** Manually crediting USDT to a customer's wallet. Never implied by another grant. */
  | "wallet_credits";

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

export type KycDocumentType =
  | "passport"
  | "national_id"
  | "driving_licence"
  | "aadhaar"
  | "pan";

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
  /**
   * Why a confirmed transfer could not be matched to a deposit request —
   * already a sentence for the operator. Absent once attributed.
   */
  unmatchedReason?: string;
  /** The deposit request that was credited by this transfer, if any. */
  depositRequestId?: string;
  /**
   * Customers who submitted this transaction hash against one of their own
   * requests. A claim is evidence for the operator, never proof of ownership —
   * anyone can copy a hash from a public explorer.
   */
  claims?: AdminDepositClaim[];
}

export interface AdminDepositClaim {
  requestId: string;
  userId: string;
  userName: string;
  userDisplayId: string;
  /** What that request asked them to send, for comparison with the chain. */
  expectedAmountUsdt: number;
  requestCreatedAt: string;
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
  /**
   * The plan's amount-banded rate ladder, lowest band first. Empty when the
   * plan has none and `estimatedReturnPercent` prices every allocation.
   */
  rateTiers: AdminPlanRateTier[];
  /** Live figures a real products service would compute. */
  stats: {
    activeInvestments: number;
    totalAllocated: number;
    totalProfitPaid: number;
  };
  updatedAt: string;
}

/**
 * One editable band. Identical in substance to the public `PlanRateTierView` —
 * it is deliberately not shared, because the two applications are isolated
 * (CLAUDE.md §15.1) and the CRM's copy carries the inactive bands the public
 * one filters out.
 */
export interface AdminPlanRateTier {
  id: string;
  minAmountUsdt: number;
  /** `null` means open-ended: this is the top band. */
  maxAmountUsdt: number | null;
  ratePercent: number;
  active: boolean;
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
  /**
   * When this entry becomes payable, stamped at accrual from the operator's
   * `payoutDelayDays`. Null on entries accrued before the schedule existed —
   * the nightly job leaves those to an operator rather than inventing a date.
   */
  releaseAt: string | null;
  /** When it was actually paid, by the scheduler or by an operator. */
  releasedAt: string | null;
}

/**
 * The single configured deposit address, as the CRM shows it.
 *
 * `source` says where the active value comes from: an operator's saved
 * configuration, or — until one is saved — the deployment's
 * `TRON_PLATFORM_DEPOSIT_ADDRESS`. Null `address` means deposits cannot be
 * requested at all.
 */
export interface AdminDepositConfiguration {
  network: string;
  networkLabel: string;
  asset: "USDT";
  standard: "TRC-20";
  address: string | null;
  source: "configured" | "environment" | "none";
  updatedAt: string | null;
  updatedBy: string | null;
  /** Recent changes, from the audit log. */
  history: {
    id: string;
    at: string;
    actor: string;
    details: string;
  }[];
}

/**
 * The six figures on the CRM dashboard's "needs attention" row.
 *
 * Counted in SQL (`readDashboardMetrics`) rather than derived in the browser
 * from four full platform tables, which is what the dashboard used to do.
 *
 * The two USDT figures are **display aggregates** — "how much is in flight"
 * beside a queue count. Nothing is derived from them: no balance, no ledger
 * entry and no payout. Money that decides anything goes through `@/db/money`.
 */
export interface AdminDashboardMetrics {
  kycPending: number;
  depositsPending: number;
  depositsPendingUsdt: number;
  withdrawalsPending: number;
  withdrawalsPendingUsdt: number;
  usersRestricted: number;
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
  | "deposit_address_added"
  | "deposit_address_released"
  | "deposit_address_retired"
  | "deposit_address_configured"
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
  | "settings_updated"
  | "wallet_manual_credit"
  | "withdrawal_password_reset";

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

/**
 * The `platform_settings.platform` column as stored. It carries one key the
 * CRM's general settings form never sees: the customer-support Telegram
 * username, which has its own validated action (`updateSupportTelegramAction`)
 * and is stripped from `PlatformSettings` by the mapper so the general form
 * cannot overwrite it with a stale copy.
 */
export type StoredPlatformSection = PlatformSettings["platform"] & {
  supportTelegram?: string | null;
};

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

/* -------------------------------------------------------------------------- */
/* Server-side list pagination                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One page of a CRM list, plus what the pager needs to describe it.
 *
 * `total` is the size of the **filtered** set, not the table — it is what
 * "page 3 of 47" and a disabled *Next* are computed from, so it has to be
 * counted under the same predicates that selected the rows.
 *
 * Lives here rather than beside the query because the pager and every list
 * view are client components: a type imported from a `server-only` module
 * fails the build, which is how `AdminDashboardMetrics` ended up here too.
 */
export interface PagedResult<T> {
  rows: T[];
  /** Rows matching the filters, across every page. */
  total: number;
  /** 1-based, clamped to `pageCount`. */
  page: number;
  pageSize: number;
  /** At least 1, so an empty result still reads as "page 1 of 1". */
  pageCount: number;
}

/**
 * The query behind a CRM list screen, parsed from the URL.
 *
 * Every field is derived from untrusted input, so each is validated where it
 * is parsed (`@/server/services/admin-list-query`) rather than where it is
 * used: `page` is clamped positive, `pageSize` is **not** client-settable at
 * all — a caller-chosen page size is an unbounded read wearing a parameter —
 * and `status`/`sort` are matched against a per-screen allowlist so neither
 * can reach SQL as text.
 */
export interface AdminListQuery {
  page: number;
  pageSize: number;
  /** Free text, trimmed; empty means "no search". */
  search: string;
  /** A screen-specific token from that screen's allowlist. */
  status: string;
  /**
   * The screen's second filter dimension, where it has one — the directory's
   * KYC state, the allocation list's plan, the referral list's VIP level.
   *
   * Unlike `status` and `sort` this is **not** allowlisted, because some
   * screens filter on an id that only the database knows (a plan's). It is
   * length-bounded and always reaches SQL as a bound parameter, so the worst
   * an unknown value can do is match no rows.
   */
  filter: string;
  /** A screen-specific token from that screen's allowlist. */
  sort: string;
}

/**
 * A list screen's whole payload: one page of rows, plus how many rows each
 * status chip would show under the screen's other filters.
 *
 * The counts are part of the screen rather than a detail of the pager because
 * they are what an operator triages by — a queue chip reading "3" is the
 * reason to open it.
 */
export interface AdminListPage<T> {
  result: PagedResult<T>;
  statusCounts: Record<string, number>;
}

/* -------------------------------------------------------------------------- */
/* List screen summaries                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The stat cards above a paginated list.
 *
 * These describe the **whole table**, not the page and not the filtered set —
 * which is what they always described, when the browser held every row and
 * reduced over it. Server-side paging means the rows are no longer there to
 * reduce, so each figure is now a SQL aggregate. Getting this wrong would be
 * worse than slow: "Open requests 4" computed over a ten-row page is not a
 * smaller number, it is a false one.
 */
export interface AdminDepositsSummary {
  creditedUsdt: number;
  inFlightCount: number;
  inFlightUsdt: number;
}

export interface AdminWithdrawalsSummary {
  openCount: number;
  openUsdt: number;
  paidNetInr: number;
}

export interface AdminInvestmentsSummary {
  activeCount: number;
  totalCount: number;
  allocatedUsdt: number;
  accruedProfitUsdt: number;
}

/**
 * The minimum an operator needs to pick an account out of a list.
 *
 * Deliberately not `AdminUser`: a picker shows a name and a member id, and
 * sending a balance, a KYC state and a wallet address per candidate is how the
 * attribution dialog ended up costing the whole directory.
 */
export interface AdminUserOption {
  id: string;
  fullName: string;
  email: string;
  displayId: string;
}

export interface AdminReferralsSummary {
  creditedCommissionUsdt: number;
  pendingCommissionUsdt: number;
  totalTeamVolumeUsdt: number;
}

/** What the confirmation shows, so a wrong id is caught before money moves. */
export interface ManualCreditCustomer {
  userId: string;
  displayId: string;
  fullName: string;
  /** Masked — enough to recognise on a call, not to contact. */
  phone: string | null;
  status: string;
  kycStatus: string;
  availableUsdt: number;
}

/** One manual credit, as the CRM history lists it. */
export interface ManualCreditRecord {
  id: string;
  userId: string;
  displayId: string;
  customerName: string;
  amountUsdt: number;
  note: string | null;
  ledgerTxId: string;
  createdByName: string;
  createdAt: string;
}
