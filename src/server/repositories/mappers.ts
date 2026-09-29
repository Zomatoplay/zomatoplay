import "server-only";

import type { schema } from "@/db";
import {
  unmatchedDepositReasonLabels,
  type UnmatchedDepositReason,
} from "@/data/deposit-requests";
import type {
  AppNotification,
  BankAccount,
  CommissionEntry,
  DepositNetwork,
  Investment,
  InvestmentStatus,
  KycStep,
  Plan,
  Referral,
  SavedWalletAddress,
  SecurityActivity,
  SupportTicket,
  Transaction,
  UserProfile,
  VipLevel,
  WalletBalance,
} from "@/types";
import type {
  AdminCommissionEntry,
  AdminDeposit,
  AdminInvestment,
  AdminInvestmentStatus,
  AdminNotificationCampaign,
  AdminPermissionId,
  AdminPermissionLevel,
  AdminPermissionSet,
  AdminPlan,
  AdminReferralAccount,
  AdminUser,
  AdminWithdrawal,
  AuditLogEntry,
  KycSubmission,
  PlatformSettings,
  UserDeviceSession,
  UserSecurityEvent,
} from "@/types/admin";

/**
 * Row → domain mapping.
 *
 * The domain types in `@/types` are the contract the components were written
 * against, and they are unchanged: dates are ISO strings, money is a number,
 * optional fields are `undefined` rather than `null`. Everything that has to
 * bend to fit the database bends here, in one place, so no component ever
 * learns what a row looks like.
 */

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

type UserRow = Row<typeof schema.users>;
type WalletRow = Row<typeof schema.walletBalances>;
type PlanRow = Row<typeof schema.plans>;
type PlanRateTierRow = Row<typeof schema.planRateTiers>;
type InvestmentRow = Row<typeof schema.investments>;
type TransactionRow = Row<typeof schema.transactions>;
type DepositRow = Row<typeof schema.deposits>;
type WithdrawalRow = Row<typeof schema.withdrawals>;
type KycStepRow = Row<typeof schema.userKycSteps>;
type KycSubmissionRow = Row<typeof schema.kycSubmissions>;
type KycDocumentRow = Row<typeof schema.kycDocuments>;
type KycNoteRow = Row<typeof schema.kycNotes>;
type ReferralRow = Row<typeof schema.referrals>;
type ReferralAccountRow = Row<typeof schema.referralAccounts>;
type CommissionRow = Row<typeof schema.commissionEntries>;
type VipLevelRow = Row<typeof schema.vipLevels>;
type NotificationRow = Row<typeof schema.notifications>;
type CampaignRow = Row<typeof schema.notificationCampaigns>;
type DeviceSessionRow = Row<typeof schema.userDeviceSessions>;
type SecurityEventRow = Row<typeof schema.userSecurityEvents>;
type AuditLogRow = Row<typeof schema.auditLogs>;
type SettingsRow = Row<typeof schema.platformSettings>;
type BankAccountRow = Row<typeof schema.bankAccounts>;
type WalletAddressRow = Row<typeof schema.walletAddresses>;
type DepositNetworkRow = Row<typeof schema.depositNetworks>;
type SupportTicketRow = Row<typeof schema.supportTickets>;

/** Domain types carry ISO strings; the driver returns `Date`. */
export const iso = (value: Date): string => value.toISOString();
export const isoOrNull = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/** Domain types use `undefined` for "absent"; a column uses `null`. */
const optional = <T>(value: T | null): T | undefined =>
  value === null ? undefined : value;

/* -------------------------------------------------------------------------- */
/* User application                                                            */
/* -------------------------------------------------------------------------- */

export function toUserProfile(user: UserRow, steps: KycStepRow[]): UserProfile {
  return {
    id: user.id,
    displayId: user.displayId,
    fullName: user.fullName,
    // Null for an account created by phone sign-in; the domain keeps a string
    // and renders an empty one as "not added".
    email: user.email ?? "",
    phone: user.phone,
    phoneVerified: user.phoneE164 !== null,
    avatarUrl: user.avatarUrl,
    country: user.country,
    memberSince: iso(user.registeredAt),
    kycStatus: user.kycStatus,
    kycSteps: steps
      .slice()
      .sort((a, b) => a.position - b.position)
      .map(toKycStep),
    twoFactorEnabled: user.twoFactorEnabled,
    googleAuthEnabled: user.googleAuthEnabled,
    vipLevel: user.vipLevel,
    referralCode: user.referralCode,
  };
}

export function toKycStep(step: KycStepRow): KycStep {
  return {
    id: step.stepId,
    title: step.title,
    description: step.description,
    status: step.status,
  };
}

export function toWalletBalance(wallet: WalletRow): WalletBalance {
  return {
    available: wallet.available,
    totalDeposited: wallet.totalDeposited,
    totalInvested: wallet.totalInvested,
    totalWithdrawn: wallet.totalWithdrawn,
    totalProfit: wallet.totalProfit,
    lockedInInvestments: wallet.lockedInInvestments,
  };
}

export function toBankAccount(account: BankAccountRow): BankAccount {
  return {
    id: account.id,
    label: account.label,
    bankName: account.bankName,
    accountNumberMasked: account.accountNumberMasked,
    ifsc: account.ifsc,
    holderName: account.holderName,
    isDefault: account.isDefault,
  };
}

export function toSavedWalletAddress(
  address: WalletAddressRow,
): SavedWalletAddress {
  return {
    id: address.id,
    label: address.label,
    network: address.network,
    address: address.address,
    isDefault: address.isDefault,
  };
}

export function toDepositNetwork(network: DepositNetworkRow): DepositNetwork {
  return {
    id: network.id,
    name: network.name,
    chain: network.chain,
    address: network.address,
    minDeposit: network.minDeposit,
    estimatedArrival: network.estimatedArrival,
    requiredConfirmations: network.requiredConfirmations,
    networkFeeNote: network.networkFeeNote,
    recommended: network.recommended || undefined,
  };
}

/**
 * The public plan projection.
 *
 * A `disabled` plan has no representation here — the catalogue query filters
 * those rows out rather than translating them, because "disabled" means
 * withdrawn from the app entirely, not closed to new money.
 */
/** One rate band, as both applications' screens read it. */
export function toPlanRateTierView(tier: PlanRateTierRow) {
  return {
    id: tier.id,
    minAmountUsdt: tier.minAmountUsdt,
    maxAmountUsdt: tier.maxAmountUsdt,
    ratePercent: tier.ratePercent,
    active: tier.active,
  };
}

/**
 * A plan, with its rate ladder attached.
 *
 * The ladder arrives as a second argument rather than being joined into the
 * row: `plans` is read four different ways (public catalogue, CRM catalogue,
 * a single plan inside `createInvestment`'s transaction) and only two of them
 * want the bands. Defaulting to an empty ladder is what keeps every existing
 * caller correct — a plan with no bands is priced by its own rate, which is
 * exactly the behaviour every plan had before the ladder existed.
 */
export function toPlan(plan: PlanRow, tiers: PlanRateTierRow[] = []): Plan {
  return {
    // Inactive bands are filtered out here and not in the query: the CRM reads
    // the same rows and needs them. A customer has no use for a band that
    // cannot price their money.
    rateTiers: tiers
      .filter((tier) => tier.active)
      .map(toPlanRateTierView),
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    tagline: plan.tagline,
    description: plan.description,
    howItWorks: plan.howItWorks,
    minInvestment: plan.minInvestment,
    maxInvestment: plan.maxInvestment,
    durationDays: plan.durationDays,
    estimatedReturnPercent: plan.estimatedReturnPercent,
    estimatedReturnRange: [plan.estimatedReturnLow, plan.estimatedReturnHigh],
    rewardFrequency: plan.rewardFrequency,
    risk: plan.risk,
    status: plan.status === "disabled" ? "closed" : plan.status,
    capacityFilledPercent: optional(plan.capacityFilledPercent),
    highlights: plan.highlights,
    conditions: plan.conditions,
    riskNotes: plan.riskNotes,
    earlyExit: plan.earlyExit,
    popular: plan.popular || undefined,
  };
}

/**
 * The user-facing investment.
 *
 * The stored status is `matured`; the user application has always called that
 * "completed". The word differs, the record does not.
 */
export function toInvestment(investment: InvestmentRow): Investment {
  const status: InvestmentStatus =
    investment.status === "matured" ? "completed" : investment.status;

  return {
    id: investment.id,
    planId: investment.planId,
    planName: investment.planName,
    amount: investment.amount,
    profit: investment.profit,
    projectedProfit: investment.projectedProfit,
    startDate: iso(investment.startedAt),
    endDate: iso(investment.maturesAt),
    durationDays: investment.durationDays,
    elapsedDays: investment.elapsedDays,
    status,
    rewardFrequency: investment.rewardFrequency,
    nextRewardDate: isoOrNull(investment.nextRewardAt),
    nextRewardAmount: investment.nextRewardAmount,
    risk: investment.risk,
  };
}

export function toTransaction(transaction: TransactionRow): Transaction {
  return {
    id: transaction.id,
    type: transaction.type,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    date: iso(transaction.occurredAt),
    description: transaction.description,
    reference: optional(transaction.reference),
    network: optional(transaction.network),
    confirmations:
      transaction.confirmationsCurrent !== null &&
      transaction.confirmationsRequired !== null
        ? {
            current: transaction.confirmationsCurrent,
            required: transaction.confirmationsRequired,
          }
        : undefined,
    inrAmount: optional(transaction.inrAmount),
    feeUsdt: optional(transaction.feeUsdt),
  };
}

export function toAppNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    date: iso(row.createdAt),
    read: row.read,
  };
}

/**
 * The user's plain-language view of their own security history.
 *
 * The CRM sees the full event; the user sees what happened. `blocked` is the
 * only outcome that is not a success, and it is surfaced with words as well as
 * a colour — the badge these feed pairs an icon with the label.
 */
export function toSecurityActivity(event: SecurityEventRow): SecurityActivity {
  return {
    id: event.id,
    event: event.description,
    device: event.device,
    location: event.location,
    date: iso(event.createdAt),
    status: event.outcome,
  };
}

export function toSupportTicket(ticket: SupportTicketRow): SupportTicket {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    updatedAt: iso(ticket.updatedAt),
    messages: ticket.messageCount,
  };
}

export function toVipLevel(level: VipLevelRow): VipLevel {
  return {
    id: level.id,
    name: level.name,
    tier1CommissionPercent: level.tier1CommissionPercent,
    tier2CommissionPercent: level.tier2CommissionPercent,
    requirements: {
      activeReferrals: level.requiredActiveReferrals,
      teamVolumeUsdt: level.requiredTeamVolumeUsdt,
    },
    benefits: level.benefits,
  };
}

export function toReferral(referral: ReferralRow): Referral {
  return {
    id: referral.id,
    name: referral.name,
    maskedEmail: referral.maskedEmail,
    joinedDate: iso(referral.joinedAt),
    status: referral.status,
    investedAmount: referral.investedAmount,
    earnedFromReferral: referral.earnedFromReferral,
    tier: referral.tier === 2 ? 2 : 1,
  };
}

export function toCommissionEntry(entry: CommissionRow): CommissionEntry {
  return {
    id: entry.id,
    referralName: entry.sourceUserName,
    date: iso(entry.createdAt),
    amount: entry.amountUsdt,
    tier: entry.tier === 2 ? 2 : 1,
    sourcePlan: entry.sourcePlanName,
  };
}

/* -------------------------------------------------------------------------- */
/* Master CRM                                                                  */
/* -------------------------------------------------------------------------- */

export function toAdminUser(user: UserRow, wallet: WalletRow | null): AdminUser {
  return {
    id: user.id,
    displayId: user.displayId,
    fullName: user.fullName,
    // Null for an account created by phone sign-in; the domain keeps a string
    // and renders an empty one as "not added".
    email: user.email ?? "",
    phone: user.phone,
    country: user.country,
    registeredAt: iso(user.registeredAt),
    lastActiveAt: iso(user.lastActiveAt),
    status: user.status,
    kycStatus: user.kycStatus,
    vipLevel: user.vipLevel,
    referralCode: user.referralCode,
    referredByCode: user.referredByCode,
    referralCount: user.referralCount,
    walletAddress: user.walletAddress,
    totals: {
      availableUsdt: wallet?.available ?? 0,
      lockedUsdt: wallet?.lockedInInvestments ?? 0,
      totalDeposited: wallet?.totalDeposited ?? 0,
      totalInvested: wallet?.totalInvested ?? 0,
      totalProfit: wallet?.totalProfit ?? 0,
      totalWithdrawn: wallet?.totalWithdrawn ?? 0,
    },
    restrictions: {
      accountFrozen: user.accountFrozen,
      withdrawalsFrozen: user.withdrawalsFrozen,
      investmentsFrozen: user.investmentsFrozen,
    },
    twoFactorEnabled: user.twoFactorEnabled,
    internalNote: optional(user.internalNote),
  };
}

export function toAdminPlan(
  plan: PlanRow,
  tiers: PlanRateTierRow[] = [],
): AdminPlan {
  return {
    // Every band, inactive included: an operator edits what is there.
    rateTiers: tiers.map(toPlanRateTierView),
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    tagline: plan.tagline,
    description: plan.description,
    minInvestment: plan.minInvestment,
    maxInvestment: plan.maxInvestment,
    durationDays: plan.durationDays,
    estimatedReturnPercent: plan.estimatedReturnPercent,
    estimatedReturnRange: [plan.estimatedReturnLow, plan.estimatedReturnHigh],
    rewardFrequency: plan.rewardFrequency,
    risk: plan.risk,
    status: plan.status,
    capacityFilledPercent: optional(plan.capacityFilledPercent),
    stats: {
      activeInvestments: plan.activeInvestments,
      totalAllocated: plan.totalAllocated,
      totalProfitPaid: plan.totalProfitPaid,
    },
    updatedAt: iso(plan.updatedAt),
  };
}

/** The CRM's rows carry the account's name so a table needs no second lookup. */
export interface UserLabel {
  userName: string;
  userDisplayId: string;
}

export function toAdminInvestment(
  investment: InvestmentRow,
  user: UserLabel,
): AdminInvestment {
  const status: AdminInvestmentStatus = investment.status;

  return {
    id: investment.id,
    userId: investment.userId,
    userName: user.userName,
    userDisplayId: user.userDisplayId,
    planId: investment.planId,
    planName: investment.planName,
    amountUsdt: investment.amount,
    profitUsdt: investment.profit,
    projectedProfitUsdt: investment.projectedProfit,
    startedAt: iso(investment.startedAt),
    maturesAt: iso(investment.maturesAt),
    durationDays: investment.durationDays,
    elapsedDays: investment.elapsedDays,
    rewardFrequency: investment.rewardFrequency,
    nextRewardAt: isoOrNull(investment.nextRewardAt),
    nextRewardAmount: investment.nextRewardAmount,
    risk: investment.risk,
    status,
  };
}

export function toAdminDeposit(
  deposit: DepositRow,
  user: UserLabel | null,
): AdminDeposit {
  return {
    id: deposit.id,
    userId: deposit.userId,
    // The CRM shows a name on every row; an unattributed deposit says so
    // rather than borrowing one.
    userName: user?.userName ?? "Unassigned",
    userDisplayId: user?.userDisplayId ?? "—",
    assignedAt: isoOrNull(deposit.assignedAt),
    assignedBy: deposit.assignedBy,
    amountUsdt: deposit.amountUsdt,
    network: deposit.network,
    chain: deposit.chain,
    chainNetwork: deposit.chainNetwork,
    tokenContract: deposit.tokenContract,
    tokenSymbol: deposit.tokenSymbol,
    senderAddress: deposit.senderAddress,
    walletAddress: deposit.walletAddress,
    txHash: deposit.txHash,
    // `bigint` would not survive serialisation to a client component, and the
    // number is an identifier rather than a quantity, so it travels as text.
    blockNumber: deposit.blockNumber === null ? null : deposit.blockNumber.toString(),
    blockTimestamp: isoOrNull(deposit.blockTimestamp),
    createdAt: iso(deposit.createdAt),
    detectedAt: isoOrNull(deposit.detectedAt),
    confirmedAt: isoOrNull(deposit.confirmedAt),
    creditedAt: isoOrNull(deposit.creditedAt),
    confirmations: {
      current: deposit.confirmationsCurrent,
      required: deposit.confirmationsRequired,
    },
    status: deposit.status,
    verification: deposit.verification,
    failureReason: optional(deposit.failureReason),
    unmatchedReason:
      deposit.userId === null && deposit.unmatchedReason
        ? (unmatchedDepositReasonLabels[deposit.unmatchedReason as UnmatchedDepositReason] ??
          deposit.unmatchedReason)
        : undefined,
  };
}

export function toAdminWithdrawal(
  withdrawal: WithdrawalRow,
  user: UserLabel,
): AdminWithdrawal {
  return {
    id: withdrawal.id,
    userId: withdrawal.userId,
    userName: user.userName,
    userDisplayId: user.userDisplayId,
    amountUsdt: withdrawal.amountUsdt,
    payoutRate: withdrawal.payoutRate,
    flatFeeUsdt: withdrawal.flatFeeUsdt,
    percentFeeUsdt: withdrawal.percentFeeUsdt,
    totalFeeUsdt: withdrawal.totalFeeUsdt,
    netInr: withdrawal.netInr,
    destination: {
      label: withdrawal.destinationLabel,
      bankName: withdrawal.destinationBankName,
      accountNumberMasked: withdrawal.destinationAccountMasked,
      ifsc: withdrawal.destinationIfsc,
      holderName: withdrawal.destinationHolderName,
    },
    requestedAt: iso(withdrawal.requestedAt),
    settledAt: isoOrNull(withdrawal.settledAt),
    status: withdrawal.status,
    reviewedBy: withdrawal.reviewedBy,
    rejectionReason: withdrawal.rejectionReason,
    payoutReference: withdrawal.payoutReference,
  };
}

export function toKycSubmission(
  submission: KycSubmissionRow,
  user: UserLabel,
  documents: KycDocumentRow[],
  notes: KycNoteRow[],
): KycSubmission {
  return {
    id: submission.id,
    userId: submission.userId,
    userName: user.userName,
    userDisplayId: user.userDisplayId,
    submittedAt: iso(submission.submittedAt),
    status: submission.status,
    details: {
      legalName: submission.legalName,
      dateOfBirth: submission.dateOfBirth,
      nationality: submission.nationality,
      address: submission.address,
      documentType: submission.documentType,
      documentNumberMasked: submission.documentNumberMasked,
    },
    documents: documents.map((document) => ({
      id: document.id,
      label: document.label,
      type: document.type,
      fileName: document.fileName,
      // Presence only; the key stays server-side. See `KycDocument`.
      hasFile: document.storagePath !== null,
      uploadedAt: iso(document.uploadedAt),
      pages: document.pages,
    })),
    livenessCheckPassed: submission.livenessCheckPassed,
    reviewedBy: submission.reviewedBy,
    reviewedAt: isoOrNull(submission.reviewedAt),
    rejectionReason: submission.rejectionReason,
    notes: notes.map((note) => ({
      id: note.id,
      author: note.author,
      body: note.body,
      createdAt: iso(note.createdAt),
    })),
    riskFlags: submission.riskFlags,
  };
}

export function toAdminReferralAccount(
  account: ReferralAccountRow,
  user: UserRow,
): AdminReferralAccount {
  return {
    userId: account.userId,
    userName: user.fullName,
    userDisplayId: user.displayId,
    referralCode: user.referralCode,
    vipLevel: user.vipLevel,
    directReferrals: account.directReferrals,
    indirectReferrals: account.indirectReferrals,
    activeReferrals: account.activeReferrals,
    teamVolumeUsdt: account.teamVolumeUsdt,
    commissionEarnedUsdt: account.commissionEarnedUsdt,
    commissionPendingUsdt: account.commissionPendingUsdt,
    joinedAt: iso(account.joinedAt),
  };
}

export function toAdminCommissionEntry(
  entry: CommissionRow,
  beneficiaryName: string,
): AdminCommissionEntry {
  return {
    id: entry.id,
    beneficiaryUserId: entry.beneficiaryUserId,
    beneficiaryName,
    sourceUserName: entry.sourceUserName,
    tier: entry.tier === 2 ? 2 : 1,
    amountUsdt: entry.amountUsdt,
    sourcePlanName: entry.sourcePlanName,
    createdAt: iso(entry.createdAt),
    status: entry.status,
    releaseAt: entry.releaseAt ? iso(entry.releaseAt) : null,
    releasedAt: entry.releasedAt ? iso(entry.releasedAt) : null,
  };
}

export function toUserDeviceSession(row: DeviceSessionRow): UserDeviceSession {
  return {
    id: row.id,
    userId: row.userId,
    device: row.device,
    browser: row.browser,
    os: row.os,
    ipAddress: row.ipAddress,
    location: row.location,
    loggedInAt: iso(row.loggedInAt),
    lastActiveAt: iso(row.lastActiveAt),
    status: row.status,
    current: row.isCurrent,
  };
}

export function toUserSecurityEvent(row: SecurityEventRow): UserSecurityEvent {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    description: row.description,
    device: row.device,
    ipAddress: row.ipAddress,
    location: row.location,
    createdAt: iso(row.createdAt),
    outcome: row.outcome,
  };
}

export function toAdminNotificationCampaign(
  row: CampaignRow,
): AdminNotificationCampaign {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    audience: row.audience,
    targetUserLabel: row.targetUserLabel,
    channels: row.channels,
    templateId: row.templateId,
    sentAt: iso(row.sentAt),
    sentBy: row.sentBy,
    recipientCount: row.recipientCount,
    status: row.status,
  };
}

export function toAuditLogEntry(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    actorId: row.actorId,
    actorName: row.actorName,
    actorRole: row.actorRole,
    action: row.action,
    target:
      row.targetType && row.targetId
        ? {
            type: row.targetType,
            id: row.targetId,
            label: row.targetLabel ?? row.targetId,
          }
        : null,
    createdAt: iso(row.createdAt),
    ipAddress: row.ipAddress,
    outcome: row.outcome,
    details: row.details,
  };
}

export function toPlatformSettings(row: SettingsRow): PlatformSettings {
  // The support Telegram username is left out on purpose: it has its own
  // validated write path, and a copy in the general form's draft is a copy
  // that form could write back stale (see `StoredPlatformSection`).
  const platform = { ...row.platform };
  delete platform.supportTelegram;
  return {
    platform,
    currency: row.currency,
    withdrawals: row.withdrawals,
    deposits: row.deposits,
    investments: row.investments,
    referrals: row.referrals,
    security: row.security,
  };
}

/**
 * Permission rows → the permission map the UI reads.
 *
 * Areas with no row default to `none`. That direction is deliberate: a missing
 * grant is an absent grant, never an implied one.
 */
export function toPermissionSet(
  rows: { permission: AdminPermissionId; level: AdminPermissionLevel }[],
  allPermissions: readonly AdminPermissionId[],
): AdminPermissionSet {
  const granted = new Map(rows.map((row) => [row.permission, row.level]));
  return Object.fromEntries(
    allPermissions.map((id) => [id, granted.get(id) ?? "none"]),
  ) as AdminPermissionSet;
}
