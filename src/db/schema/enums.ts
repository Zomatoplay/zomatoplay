import { pgEnum } from "drizzle-orm/pg-core";

import type { AdminPermissionId } from "@/types/admin";

/**
 * Postgres enums mirroring the string unions in `@/types` and `@/types/admin`.
 *
 * They are declared here rather than as free text columns so the database
 * rejects a value the domain does not define. Every list below must stay
 * identical to its TypeScript counterpart — the repositories cast between them,
 * and a drift would only surface at runtime.
 *
 * Two places where the database vocabulary is deliberately singular while the
 * two applications use different words for the same thing:
 *
 * - `investment_status` stores `matured`, which the CRM calls "matured" and the
 *   user application calls "completed". The repository maps it per audience.
 * - `plan_status` includes `disabled`, which only the CRM has a concept of. The
 *   user-facing catalogue filters those rows out rather than translating them.
 */

/* -------------------------------------------------------------------------- */
/* User & KYC                                                                  */
/* -------------------------------------------------------------------------- */

export const kycStatusEnum = pgEnum("kyc_status", [
  "not_started",
  "in_progress",
  "pending_review",
  "verified",
  "rejected",
]);

export const kycStepStatusEnum = pgEnum("kyc_step_status", [
  "complete",
  "current",
  "upcoming",
]);

export const kycReviewStatusEnum = pgEnum("kyc_review_status", [
  "pending",
  "under_review",
  "approved",
  "rejected",
  "resubmission_requested",
]);

export const kycDocumentTypeEnum = pgEnum("kyc_document_type", [
  "passport",
  "national_id",
  "driving_licence",
  "aadhaar",
  "pan",
]);

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "inactive",
  "blocked",
  "suspended",
  "deactivated",
]);

/* -------------------------------------------------------------------------- */
/* Plans & investments                                                         */
/* -------------------------------------------------------------------------- */

export const riskLevelEnum = pgEnum("risk_level", [
  "conservative",
  "balanced",
  "growth",
]);

export const planStatusEnum = pgEnum("plan_status", [
  "open",
  "limited",
  "closed",
  "disabled",
]);

export const rewardFrequencyEnum = pgEnum("reward_frequency", [
  "daily",
  "weekly",
  "monthly",
  "on_maturity",
]);

export const investmentStatusEnum = pgEnum("investment_status", [
  "active",
  "matured",
  "cancelled",
]);

/* -------------------------------------------------------------------------- */
/* Money movement                                                              */
/* -------------------------------------------------------------------------- */

export const depositNetworkEnum = pgEnum("deposit_network", [
  "trc20",
  "erc20",
  "bep20",
  "polygon",
]);

/**
 * `adjustment` is a balance movement an operator made by hand — today only a
 * manual USDT credit (`manual_credits` holds who, why and the idempotency
 * key). It is a ledger type like any other so the ledger still sums to the
 * balance; it is not a deposit, because no transfer arrived.
 */
export const transactionTypeEnum = pgEnum("transaction_type", [
  "deposit",
  "withdrawal",
  "investment",
  "reward",
  "referral",
  "adjustment",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "completed",
  "pending",
  "processing",
  "failed",
  "cancelled",
]);

export const currencyEnum = pgEnum("currency", ["USDT", "INR"]);

/**
 * The deposit lifecycle.
 *
 * `detected` … `confirmed` are driven by the chain scanner; `credited` and
 * `ignored` are operator decisions. A deposit sits at `confirmed` until an
 * operator attributes it to a user — see the attribution note in
 * `schema/ledger.ts` — so `confirmed` and `credited` are genuinely different
 * states, not two words for the same one.
 */
export const depositStatusEnum = pgEnum("deposit_status", [
  "pending",
  "detected",
  "confirming",
  "confirmed",
  "credited",
  "failed",
  "ignored",
]);

/**
 * Whether an on-chain deposit has been checked against the configured
 * contract, recipient and confirmation policy.
 *
 * Separate from `deposit_status` because they answer different questions:
 * status is where the money is in the process, verification is whether we
 * believe the chain data at all.
 */
export const depositVerificationEnum = pgEnum("deposit_verification", [
  "unverified",
  "verified",
  "rejected",
]);

/** Which chain a deposit arrived on. Only TRON is implemented. */
export const chainEnum = pgEnum("chain", ["tron"]);

/** Which network of that chain. Shasta is the only one used in development. */
export const chainNetworkEnum = pgEnum("chain_network", [
  "mainnet",
  "shasta",
  "nile",
]);

/** The asset a deposit address is allocated for. Only USDT is accepted today. */
export const depositAssetEnum = pgEnum("deposit_asset", ["usdt"]);

/**
 * The lifecycle of one address in the deposit-address pool.
 *
 * `available` — unassigned, may be claimed by the next user who needs one.
 * `assigned` — bound to exactly one user; the scanner attributes transfers to
 *   it automatically. `retired` — administratively withdrawn from rotation
 *   (never reused), but still watched — see `deposit_addresses` for why.
 */
/**
 * Where a customer's deposit request stands. See `deposit_requests`.
 *
 * `awaiting_payment` and `verifying` are the two *open* states — the only ones
 * that reserve the request's exact amount (see the partial unique index on the
 * table). `expired` is written lazily, by the next request creation, so an
 * abandoned request stops holding its amount without a scheduler.
 */
export const depositRequestStatusEnum = pgEnum("deposit_request_status", [
  "awaiting_payment",
  "verifying",
  "credited",
  "needs_review",
  "expired",
  "rejected",
  "cancelled",
]);

export const depositAddressStatusEnum = pgEnum("deposit_address_status", [
  "available",
  "assigned",
  "retired",
]);

export const withdrawalStatusEnum = pgEnum("withdrawal_status", [
  "pending",
  "under_review",
  "approved",
  "processing",
  "paid",
  "rejected",
  "failed",
]);

/* -------------------------------------------------------------------------- */
/* Referrals                                                                   */
/* -------------------------------------------------------------------------- */

export const vipLevelEnum = pgEnum("vip_level", ["vip1", "vip2", "vip3"]);

export const referralStatusEnum = pgEnum("referral_status", [
  "active",
  "registered",
  "inactive",
]);

export const commissionStatusEnum = pgEnum("commission_status", [
  "credited",
  "pending",
  "reversed",
]);

/* -------------------------------------------------------------------------- */
/* Engagement                                                                  */
/* -------------------------------------------------------------------------- */

export const notificationCategoryEnum = pgEnum("notification_category", [
  "deposit",
  "withdrawal",
  "investment",
  "profit",
  "referral",
  "announcement",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "in_app",
  "email",
  "push",
]);

export const notificationAudienceEnum = pgEnum("notification_audience", [
  "single_user",
  "all_users",
  "kyc_pending",
  "kyc_approved",
  "active_investors",
  "inactive_users",
  "vip",
  "blocked_users",
]);

export const notificationTemplateEnum = pgEnum("notification_template", [
  "announcement",
  "kyc_reminder",
  "deposit_credited",
  "withdrawal_processed",
  "investment_matured",
  "custom",
]);

export const campaignStatusEnum = pgEnum("campaign_status", [
  "sent",
  "scheduled",
  "failed",
]);

/**
 * `open` — waiting on support (new, or the customer replied).
 * `awaiting_reply` — support answered; waiting on the customer.
 * `resolved` — closed. A customer reply reopens it.
 */
export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "awaiting_reply",
  "resolved",
]);

export const ticketCategoryEnum = pgEnum("ticket_category", [
  "deposit",
  "withdrawal",
  "investment",
  "verification",
  "account",
  "other",
]);

export const ticketAuthorEnum = pgEnum("ticket_author", ["customer", "support"]);

/* -------------------------------------------------------------------------- */
/* Devices & security                                                          */
/* -------------------------------------------------------------------------- */

export const deviceSessionStatusEnum = pgEnum("device_session_status", [
  "active",
  "expired",
  "revoked",
]);

export const securityEventTypeEnum = pgEnum("security_event_type", [
  "login",
  "failed_login",
  "password_changed",
  "two_factor_changed",
  "account_locked",
  "device_logged_out",
  "withdrawal_address_added",
]);

export const outcomeEnum = pgEnum("outcome", ["success", "blocked"]);

/* -------------------------------------------------------------------------- */
/* Observability                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The parts of the system a pipeline event can come from.
 *
 * Coarse on purpose: this is the filter an operator reaches for when something
 * is wrong ("deposits are not appearing"), not a module list. `operation`
 * carries the detail.
 */
export const pipelineEnum = pgEnum("pipeline", [
  "navigation",
  "auth",
  "kyc",
  "deposit",
  "chain_scanner",
  "investment",
  "withdrawal",
  "email",
  "database",
  "admin",
  "support",
]);

/**
 * Which tier of the stack an event came from.
 *
 * This is what turns the log from a list into a trace: filtered by correlation
 * id and read in order, the layer column shows where a request actually spent
 * its time — a slow page with `external` at 240ms three times over is a very
 * different problem from one with a single 900ms `database` row.
 */
export const pipelineLayerEnum = pgEnum("pipeline_layer", [
  "client",
  "server",
  "database",
  "external",
  "blockchain",
]);

/** Who caused it. `system` covers the scanner and anything scheduled. */
export const pipelineActorTypeEnum = pgEnum("pipeline_actor_type", [
  "user",
  "admin",
  "system",
]);

/**
 * `started` exists so an operation that never finishes is still visible.
 * A step that hangs writes `started` and nothing else, which is exactly the
 * shape of the failure that is otherwise invisible in a log of completions.
 */
export const pipelineStatusEnum = pgEnum("pipeline_status", [
  "started",
  "ok",
  "failed",
]);

/* -------------------------------------------------------------------------- */
/* Administration                                                              */
/* -------------------------------------------------------------------------- */

export const adminRoleEnum = pgEnum("admin_role", ["master_admin", "agent"]);

export const agentStatusEnum = pgEnum("agent_status", [
  "active",
  "disabled",
  "invited",
]);

/**
 * The 14 governable areas of the CRM. This list is the contract a backend
 * authorization layer must implement; it must stay identical to
 * `ADMIN_PERMISSIONS` in `@/constants/admin`.
 */
export const adminPermissionEnum = pgEnum("admin_permission", [
  "users",
  "user_details",
  "kyc",
  "deposits",
  "withdrawals",
  "investments",
  "plans",
  "referrals",
  "notifications",
  "audit_logs",
  "settings",
  "security",
  "agents",
  "wallet_credits",
]);

export const adminPermissionLevelEnum = pgEnum("admin_permission_level", [
  "none",
  "view",
  "manage",
]);

/**
 * Pins the two permission lists together at compile time.
 *
 * `AdminPermissionId` in `@/types/admin` is what the UI and
 * `ADMIN_PERMISSIONS` are built from; the enum above is what the database will
 * accept. They have to be the same set, and a mismatch would otherwise only
 * show up as a failed insert. Adding an id to one without the other is a type
 * error here.
 */
type AssertSameSet<A extends B, B extends C, C = A> = true;
export type PermissionIdsMatch = AssertSameSet<
  AdminPermissionId,
  (typeof adminPermissionEnum.enumValues)[number]
>;

export const auditActionEnum = pgEnum("audit_action", [
  "kyc_approved",
  "kyc_rejected",
  "kyc_resubmission_requested",
  "kyc_note_added",
  "user_blocked",
  "user_unblocked",
  "user_suspended",
  "user_deactivated",
  "user_updated",
  "user_password_reset",
  "user_two_factor_reset",
  "user_restriction_changed",
  "device_logged_out",
  "all_devices_logged_out",
  "deposit_credited",
  "deposit_failed",
  "deposit_address_added",
  "deposit_address_released",
  "deposit_address_retired",
  "deposit_address_configured",
  "withdrawal_approved",
  "withdrawal_rejected",
  "withdrawal_marked_paid",
  "plan_created",
  "plan_updated",
  "plan_disabled",
  "plan_enabled",
  "agent_created",
  "agent_updated",
  "agent_disabled",
  "agent_enabled",
  "agent_password_reset",
  "agent_permissions_changed",
  "notification_sent",
  "settings_updated",
  "wallet_manual_credit",
  "wallet_manual_debit",
  "withdrawal_password_reset",
  "ticket_replied",
  "ticket_status_changed",
]);

export const auditTargetTypeEnum = pgEnum("audit_target_type", [
  "user",
  "agent",
  "plan",
  "deposit",
  "withdrawal",
  "kyc",
  "notification",
  "settings",
  "ticket",
]);

export const auditOutcomeEnum = pgEnum("audit_outcome", ["success", "failed"]);
