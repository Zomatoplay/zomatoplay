import {
  adminAgents,
  adminCommissionLedger,
  adminDeposits,
  adminInvestments,
  adminReferralAccounts,
  adminUsers,
  adminWithdrawals,
  auditLogEntries,
  kycSubmissions,
  notificationCampaigns,
  platformSettings,
  userDeviceSessions,
  userSecurityEvents,
} from "@/data/admin";
import { adminPlans } from "@/data/admin/plans";
import { investments as userInvestments } from "@/data/investments";
import {
  notificationPreferences,
  notifications as userNotifications,
} from "@/data/notifications";
import { plans as catalogue } from "@/data/plans";
import {
  commissionHistory,
  referrals as userReferrals,
  vipLevels as vipLevelCatalogue,
} from "@/data/referrals";
import { supportTickets as userSupportTickets } from "@/data/support";
import {
  depositNetworks,
  transactions as userTransactions,
} from "@/data/transactions";
import {
  currentUser,
  savedBankAccounts,
  savedWalletAddresses,
} from "@/data/user";
import type { PgTable } from "drizzle-orm/pg-core";

import type { KycStatus } from "@/types";

import type { Database } from "../client";
import * as t from "../schema";

/**
 * Development seed.
 *
 * The source is the mock modules in `@/data` — the same records the prototype
 * has always rendered — rather than a second, invented dataset. That is the
 * point: seeding must produce the application everyone already knows, so a
 * difference after switching the database on is a bug and not a data change.
 *
 * Reconciling the two mock datasets
 * ---------------------------------
 * The user application and the CRM were written from opposite sides of the
 * same platform and overlap in three places. Where they describe the same
 * record twice, one side wins, and the choice is recorded here rather than
 * left implicit:
 *
 * - **Investments.** The demo account's allocations come from the user app's
 *   dataset, because its wallet reconciles exactly against them (2,500 + 1,200
 *   + 200 = the 3,900 USDT shown as locked). The CRM's three rows for that same
 *   account are a differently-imagined version of the same money, so they are
 *   dropped. Every other user's allocations come from the CRM.
 * - **Security events.** `sec_1…4` and `sev_2001…2004` are the same four events
 *   at the same timestamps. Only the CRM's are stored; the user's security
 *   screen renders a plain-language projection of those rows.
 * - **Commissions.** The CRM ledger and the user's history share two entries
 *   (same amount, same instant). Those are stored once, and the user's four
 *   remaining entries are added to the ledger.
 *
 * Destructive by design: it clears every table before inserting, so it can be
 * re-run. `npm run db:seed` refuses to touch a production database.
 */

const DEMO_USER_ID = currentUser.id;

/**
 * The size of the development dataset.
 *
 * Thirty accounts: enough for the CRM's tables, filters and pagination to be
 * exercised honestly, few enough to read end to end when something looks wrong.
 * The mock module carries a couple more; the surplus is dropped here rather
 * than deleted there, so the fixture stays whole and the *dataset* is what has
 * a size.
 *
 * Every dependent record is filtered against these ids. A deposit belonging to
 * a user who did not make the cut is not seeded — an orphan would either
 * violate a foreign key or, worse, sit in the CRM attached to nobody.
 *
 * This is a baseline, not a ceiling. Registrations through the real sign-in
 * flow push the count past thirty, which is expected.
 */
export const SEED_USER_COUNT = 30;

const seededUsers = adminUsers.slice(0, SEED_USER_COUNT);
const seededUserIds = new Set(seededUsers.map((user) => user.id));

/** True when a record belongs to an account in the dataset. */
const isSeeded = (userId: string | null | undefined): boolean =>
  userId !== null && userId !== undefined && seededUserIds.has(userId);

/** Postgres caps a statement's parameters; large tables go in slices. */
const CHUNK = 400;

function date(iso: string): Date;
function date(iso: string | null): Date | null;
function date(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/**
 * Inserts rows in slices, typed against the table's own insert shape.
 *
 * The generic is what makes this seed reviewable without a database to run it
 * against: every row literal below is checked against its table at compile
 * time, so a renamed column or a value outside an enum is a type error rather
 * than a runtime failure halfway through seeding.
 */
async function insertAll<T extends PgTable>(
  db: Database,
  table: T,
  rows: T["$inferInsert"][],
): Promise<number> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    if (slice.length > 0) {
      await db.insert(table).values(slice);
    }
  }
  return rows.length;
}

/**
 * The verification step machine for one account.
 *
 * The step copy is the same for everyone — it is the flow's wording — so it is
 * taken from the demo account's steps and the statuses are derived from where
 * the account actually is.
 */
function kycStepsFor(status: KycStatus) {
  const completedThrough: Record<KycStatus, number> = {
    not_started: 0,
    in_progress: 1,
    pending_review: 3,
    verified: 4,
    rejected: 3,
  };
  const done = completedThrough[status];

  return currentUser.kycSteps.map((step, index) => ({
    stepId: step.id,
    position: index,
    title: step.title,
    description: step.description,
    status:
      index < done
        ? ("complete" as const)
        : index === done
          ? ("current" as const)
          : ("upcoming" as const),
  }));
}

/* -------------------------------------------------------------------------- */
/* Reconciliation helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Two ledger entries describe one payment when the amount and instant match. */
function isSameCommission(
  a: { amount: number; date: string },
  b: { amountUsdt: number; createdAt: string },
) {
  return a.amount === b.amountUsdt && a.date === b.createdAt;
}

/**
 * Links a referral row to a real account where the identity is unambiguous:
 * the invitee carries the referrer's code and their given name matches the
 * partially-anonymised name the referrer is shown. Anything less certain stays
 * null rather than guessing at who someone is.
 */
function resolveReferredUser(referrerCode: string, displayName: string) {
  const givenName = displayName.split(" ")[0]?.toLowerCase();
  if (!givenName) return null;
  const matches = adminUsers.filter(
    (u) =>
      u.referredByCode === referrerCode &&
      u.fullName.split(" ")[0]?.toLowerCase() === givenName,
  );
  return matches.length === 1 ? matches[0].id : null;
}

/* -------------------------------------------------------------------------- */
/* Clearing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Empties every table, children first.
 *
 * Written out rather than looped so the order is reviewable: a wrong order here
 * fails loudly on a foreign key, which is the behaviour we want.
 */
async function clear(db: Database) {
  await db.delete(t.auditLogs);
  await db.delete(t.adminAgentPermissions);
  await db.delete(t.notificationCampaigns);
  await db.delete(t.commissionEntries);
  await db.delete(t.referrals);
  await db.delete(t.referralAccounts);
  await db.delete(t.kycNotes);
  await db.delete(t.kycDocuments);
  await db.delete(t.kycSubmissions);
  await db.delete(t.withdrawals);
  // Requests reference deposits; cleared first. `deposit_settings` is NOT
  // cleared: it is an operator's choice of where real money goes, and a reseed
  // must never silently move it back to the environment's default.
  await db.delete(t.depositRequests);
  await db.delete(t.deposits);
  await db.delete(t.transactions);
  await db.delete(t.investments);
  await db.delete(t.notifications);
  await db.delete(t.userNotificationPreferences);
  await db.delete(t.supportTickets);
  await db.delete(t.userSecurityEvents);
  await db.delete(t.userDeviceSessions);
  await db.delete(t.userKycSteps);
  await db.delete(t.walletAddresses);
  await db.delete(t.bankAccounts);
  await db.delete(t.walletBalances);
  await db.delete(t.users);
  await db.delete(t.platformSettings);
  await db.delete(t.adminAgents);
  await db.delete(t.notificationCategories);
  await db.delete(t.vipLevels);
  await db.delete(t.depositNetworks);
  await db.delete(t.planRateTiers);
  await db.delete(t.plans);
}

/* -------------------------------------------------------------------------- */
/* Seeding                                                                     */
/* -------------------------------------------------------------------------- */

export interface SeedReport {
  [table: string]: number;
}

export async function seedDatabase(db: Database): Promise<SeedReport> {
  const report: SeedReport = {};
  const planStats = new Map(adminPlans.map((p) => [p.id, p]));

  // Cases belonging to accounts outside the dataset are dropped whole —
  // submission, documents and notes together — rather than leaving documents
  // pointing at a submission that was never inserted.
  const seededKycSubmissions = kycSubmissions.filter((submission) =>
    isSeeded(submission.userId),
  );

  await clear(db);

  /* ---------------------------------------------------------- Catalogue -- */

  report.plans = await insertAll(
    db,
    t.plans,
    catalogue.map((plan, index) => {
      const admin = planStats.get(plan.id);
      return {
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
        estimatedReturnLow: plan.estimatedReturnRange[0],
        estimatedReturnHigh: plan.estimatedReturnRange[1],
        rewardFrequency: plan.rewardFrequency,
        risk: plan.risk,
        status: plan.status,
        capacityFilledPercent: plan.capacityFilledPercent ?? null,
        highlights: plan.highlights,
        conditions: plan.conditions,
        riskNotes: plan.riskNotes,
        earlyExit: plan.earlyExit,
        popular: plan.popular ?? false,
        sortOrder: index,
        activeInvestments: admin?.stats.activeInvestments ?? 0,
        totalAllocated: admin?.stats.totalAllocated ?? 0,
        totalProfitPaid: admin?.stats.totalProfitPaid ?? 0,
        updatedAt: admin ? date(admin.updatedAt) : new Date(),
      };
    }),
  );

  /*
   * The rate ladders, derived in `@/data/plans` from each plan's own published
   * range rather than typed out here — see `seedRateTiers` for why, and for
   * what a band's percentage means (total return over the term, never a
   * periodic rate).
   */
  report.plan_rate_tiers = await insertAll(
    db,
    t.planRateTiers,
    catalogue.flatMap((plan) =>
      plan.rateTiers.map((tier) => ({
        id: tier.id,
        planId: plan.id,
        minAmountUsdt: tier.minAmountUsdt,
        maxAmountUsdt: tier.maxAmountUsdt,
        ratePercent: tier.ratePercent,
        active: tier.active,
      })),
    ),
  );

  report.deposit_networks = await insertAll(
    db,
    t.depositNetworks,
    depositNetworks.map((network, index) => ({
      id: network.id,
      name: network.name,
      chain: network.chain,
      address: network.address,
      minDeposit: network.minDeposit,
      estimatedArrival: network.estimatedArrival,
      requiredConfirmations: network.requiredConfirmations,
      networkFeeNote: network.networkFeeNote,
      recommended: network.recommended ?? false,
      sortOrder: index,
    })),
  );

  report.vip_levels = await insertAll(
    db,
    t.vipLevels,
    vipLevelCatalogue.map((level, index) => ({
      id: level.id,
      name: level.name,
      tier1CommissionPercent: level.tier1CommissionPercent,
      tier2CommissionPercent: level.tier2CommissionPercent,
      requiredActiveReferrals: level.requirements.activeReferrals,
      requiredTeamVolumeUsdt: level.requirements.teamVolumeUsdt,
      benefits: level.benefits,
      sortOrder: index,
    })),
  );

  report.notification_categories = await insertAll(
    db,
    t.notificationCategories,
    notificationPreferences.map((pref, index) => ({
      id: pref.id,
      label: pref.label,
      description: pref.description,
      sortOrder: index,
      defaultEnabled: pref.enabled,
    })),
  );

  /* -------------------------------------------------------------- People -- */

  report.users = await insertAll(
    db,
    t.users,
    seededUsers.map((user) => ({
      id: user.id,
      displayId: user.displayId,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      country: user.country,
      // Only the demo account carries the user application's profile extras.
      avatarUrl: user.id === DEMO_USER_ID ? currentUser.avatarUrl : null,
      registeredAt: date(user.registeredAt),
      lastActiveAt: date(user.lastActiveAt),
      status: user.status,
      kycStatus: user.kycStatus,
      vipLevel: user.vipLevel,
      referralCode: user.referralCode,
      referredByCode: user.referredByCode,
      referralCount: user.referralCount,
      walletAddress: user.walletAddress,
      twoFactorEnabled: user.twoFactorEnabled,
      googleAuthEnabled:
        user.id === DEMO_USER_ID ? currentUser.googleAuthEnabled : false,
      accountFrozen: user.restrictions.accountFrozen,
      withdrawalsFrozen: user.restrictions.withdrawalsFrozen,
      investmentsFrozen: user.restrictions.investmentsFrozen,
      internalNote: user.internalNote ?? null,
      createdAt: date(user.registeredAt),
      updatedAt: date(user.lastActiveAt),
    })),
  );

  report.wallet_balances = await insertAll(
    db,
    t.walletBalances,
    seededUsers.map((user) => ({
      userId: user.id,
      available: user.totals.availableUsdt,
      totalDeposited: user.totals.totalDeposited,
      totalInvested: user.totals.totalInvested,
      totalWithdrawn: user.totals.totalWithdrawn,
      totalProfit: user.totals.totalProfit,
      lockedInInvestments: user.totals.lockedUsdt,
      updatedAt: date(user.lastActiveAt),
    })),
  );

  report.user_kyc_steps = await insertAll(
    db,
    t.userKycSteps,
    seededUsers.flatMap((user) =>
      kycStepsFor(user.kycStatus).map((step) => ({
        userId: user.id,
        ...step,
      })),
    ),
  );

  // Payout destinations and saved addresses exist for the demo account only —
  // the CRM's dataset never modelled them.
  report.bank_accounts = await insertAll(
    db,
    t.bankAccounts,
    savedBankAccounts.map((account) => ({
      id: account.id,
      userId: DEMO_USER_ID,
      label: account.label,
      bankName: account.bankName,
      accountNumberMasked: account.accountNumberMasked,
      ifsc: account.ifsc,
      holderName: account.holderName,
      isDefault: account.isDefault,
      createdAt: date(currentUser.memberSince),
    })),
  );

  report.wallet_addresses = await insertAll(
    db,
    t.walletAddresses,
    savedWalletAddresses.map((address) => ({
      id: address.id,
      userId: DEMO_USER_ID,
      label: address.label,
      network: address.network,
      address: address.address,
      isDefault: address.isDefault,
      createdAt: date(currentUser.memberSince),
    })),
  );

  report.user_device_sessions = await insertAll(
    db,
    t.userDeviceSessions,
    userDeviceSessions.filter((s) => isSeeded(s.userId)).map((session) => ({
      id: session.id,
      userId: session.userId,
      device: session.device,
      browser: session.browser,
      os: session.os,
      ipAddress: session.ipAddress,
      location: session.location,
      loggedInAt: date(session.loggedInAt),
      lastActiveAt: date(session.lastActiveAt),
      status: session.status,
      isCurrent: session.current,
    })),
  );

  report.user_security_events = await insertAll(
    db,
    t.userSecurityEvents,
    userSecurityEvents.filter((e) => isSeeded(e.userId)).map((event) => ({
      id: event.id,
      userId: event.userId,
      type: event.type,
      description: event.description,
      device: event.device,
      ipAddress: event.ipAddress,
      location: event.location,
      createdAt: date(event.createdAt),
      outcome: event.outcome,
    })),
  );

  report.support_tickets = await insertAll(
    db,
    t.supportTickets,
    userSupportTickets.map((ticket) => ({
      id: ticket.id,
      userId: DEMO_USER_ID,
      subject: ticket.subject,
      status: ticket.status,
      updatedAt: date(ticket.updatedAt),
      messageCount: ticket.messages,
    })),
  );

  report.user_notification_preferences = await insertAll(
    db,
    t.userNotificationPreferences,
    notificationPreferences.map((pref) => ({
      userId: DEMO_USER_ID,
      category: pref.id,
      enabled: pref.enabled,
      updatedAt: date(currentUser.memberSince),
    })),
  );

  report.notifications = await insertAll(
    db,
    t.notifications,
    userNotifications.map((notification) => ({
      id: notification.id,
      userId: DEMO_USER_ID,
      category: notification.category,
      title: notification.title,
      body: notification.body,
      createdAt: date(notification.date),
      read: notification.read,
    })),
  );

  /* --------------------------------------------------------------- Money -- */

  report.investments = await insertAll(db, t.investments, [
    // See the note at the top of this file: the demo account's allocations come
    // from the user application's dataset because its wallet balances them.
    ...userInvestments.map((investment) => ({
      id: investment.id,
      userId: DEMO_USER_ID,
      planId: investment.planId,
      planName: investment.planName,
      amount: investment.amount,
      profit: investment.profit,
      projectedProfit: investment.projectedProfit,
      startedAt: date(investment.startDate),
      maturesAt: date(investment.endDate),
      durationDays: investment.durationDays,
      elapsedDays: investment.elapsedDays,
      status:
        investment.status === "completed"
          ? ("matured" as const)
          : investment.status,
      rewardFrequency: investment.rewardFrequency,
      nextRewardAt: date(investment.nextRewardDate),
      nextRewardAmount: investment.nextRewardAmount,
      risk: investment.risk,
      createdAt: date(investment.startDate),
      updatedAt: date(investment.startDate),
    })),
    ...adminInvestments
      .filter(
        (investment) =>
          investment.userId !== DEMO_USER_ID && isSeeded(investment.userId),
      )
      .map((investment) => ({
        id: investment.id,
        userId: investment.userId,
        planId: investment.planId,
        planName: investment.planName,
        amount: investment.amountUsdt,
        profit: investment.profitUsdt,
        projectedProfit: investment.projectedProfitUsdt,
        startedAt: date(investment.startedAt),
        maturesAt: date(investment.maturesAt),
        durationDays: investment.durationDays,
        elapsedDays: investment.elapsedDays,
        status: investment.status,
        rewardFrequency: investment.rewardFrequency,
        nextRewardAt: date(investment.nextRewardAt),
        nextRewardAmount: investment.nextRewardAmount,
        risk: investment.risk,
        createdAt: date(investment.startedAt),
        updatedAt: date(investment.startedAt),
      })),
  ]);

  report.transactions = await insertAll(
    db,
    t.transactions,
    userTransactions.map((transaction) => ({
      id: transaction.id,
      userId: DEMO_USER_ID,
      type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status,
      occurredAt: date(transaction.date),
      description: transaction.description,
      reference: transaction.reference ?? null,
      network: transaction.network ?? null,
      confirmationsCurrent: transaction.confirmations?.current ?? null,
      confirmationsRequired: transaction.confirmations?.required ?? null,
      inrAmount: transaction.inrAmount ?? null,
      feeUsdt: transaction.feeUsdt ?? null,
    })),
  );

  report.deposits = await insertAll(
    db,
    t.deposits,
    adminDeposits.filter((d) => isSeeded(d.userId)).map((deposit) => ({
      id: deposit.id,
      userId: deposit.userId,
      amountUsdt: deposit.amountUsdt,
      network: deposit.network,
      walletAddress: deposit.walletAddress,
      txHash: deposit.txHash,
      createdAt: date(deposit.createdAt),
      creditedAt: date(deposit.creditedAt),
      confirmationsCurrent: deposit.confirmations.current,
      confirmationsRequired: deposit.confirmations.required,
      status: deposit.status,
      failureReason: deposit.failureReason ?? null,
    })),
  );

  report.withdrawals = await insertAll(
    db,
    t.withdrawals,
    adminWithdrawals.filter((w) => isSeeded(w.userId)).map((withdrawal) => ({
      id: withdrawal.id,
      userId: withdrawal.userId,
      amountUsdt: withdrawal.amountUsdt,
      payoutRate: withdrawal.payoutRate,
      flatFeeUsdt: withdrawal.flatFeeUsdt,
      percentFeeUsdt: withdrawal.percentFeeUsdt,
      totalFeeUsdt: withdrawal.totalFeeUsdt,
      netInr: withdrawal.netInr,
      destinationLabel: withdrawal.destination.label,
      destinationBankName: withdrawal.destination.bankName,
      destinationAccountMasked: withdrawal.destination.accountNumberMasked,
      destinationIfsc: withdrawal.destination.ifsc,
      destinationHolderName: withdrawal.destination.holderName,
      requestedAt: date(withdrawal.requestedAt),
      settledAt: date(withdrawal.settledAt),
      status: withdrawal.status,
      reviewedBy: withdrawal.reviewedBy,
      rejectionReason: withdrawal.rejectionReason,
      payoutReference: withdrawal.payoutReference,
    })),
  );

  /* ----------------------------------------------------------------- KYC -- */

  report.kyc_submissions = await insertAll(
    db,
    t.kycSubmissions,
    seededKycSubmissions.map((submission) => ({
      id: submission.id,
      userId: submission.userId,
      submittedAt: date(submission.submittedAt),
      status: submission.status,
      legalName: submission.details.legalName,
      dateOfBirth: submission.details.dateOfBirth,
      nationality: submission.details.nationality,
      address: submission.details.address,
      documentType: submission.details.documentType,
      documentNumberMasked: submission.details.documentNumberMasked,
      livenessCheckPassed: submission.livenessCheckPassed,
      reviewedBy: submission.reviewedBy,
      reviewedAt: date(submission.reviewedAt),
      rejectionReason: submission.rejectionReason,
      riskFlags: submission.riskFlags,
    })),
  );

  report.kyc_documents = await insertAll(
    db,
    t.kycDocuments,
    seededKycSubmissions.flatMap((submission) =>
      submission.documents.map((document) => ({
        id: document.id,
        submissionId: submission.id,
        label: document.label,
        type: document.type,
        fileName: document.fileName,
        uploadedAt: date(document.uploadedAt),
        pages: document.pages,
      })),
    ),
  );

  report.kyc_notes = await insertAll(
    db,
    t.kycNotes,
    seededKycSubmissions.flatMap((submission) =>
      submission.notes.map((note) => ({
        id: note.id,
        submissionId: submission.id,
        author: note.author,
        body: note.body,
        createdAt: date(note.createdAt),
      })),
    ),
  );

  /* ----------------------------------------------------------- Referrals -- */

  report.referral_accounts = await insertAll(
    db,
    t.referralAccounts,
    adminReferralAccounts.filter((a) => isSeeded(a.userId)).map((account) => ({
      userId: account.userId,
      directReferrals: account.directReferrals,
      indirectReferrals: account.indirectReferrals,
      activeReferrals: account.activeReferrals,
      teamVolumeUsdt: account.teamVolumeUsdt,
      commissionEarnedUsdt: account.commissionEarnedUsdt,
      commissionPendingUsdt: account.commissionPendingUsdt,
      joinedAt: date(account.joinedAt),
      updatedAt: date(account.joinedAt),
    })),
  );

  const referralRows = [
    // The demo account's own list, as the referrer is shown it.
    ...userReferrals.map((referral) => ({
      id: referral.id,
      referrerUserId: DEMO_USER_ID,
      referredUserId: resolveReferredUser(currentUser.referralCode, referral.name),
      name: referral.name,
      maskedEmail: referral.maskedEmail,
      joinedAt: date(referral.joinedDate),
      status: referral.status,
      investedAmount: referral.investedAmount,
      earnedFromReferral: referral.earnedFromReferral,
      tier: referral.tier,
    })),
    // Every other introduction the directory records. The demo account's are
    // skipped: the rows above are the same relationships, named the way the
    // referrer sees them.
    ...seededUsers
      .filter(
        (user) =>
          user.referredByCode !== null &&
          user.referredByCode !== currentUser.referralCode,
      )
      .flatMap((user) => {
        const referrer = seededUsers.find(
          (candidate) => candidate.referralCode === user.referredByCode,
        );
        // The referrer may be one of the accounts the dataset drops; the edge
        // goes with them rather than dangling.
        if (!referrer) return [];
        const [given, family = ""] = user.fullName.split(" ");
        return [
          {
            id: `ref_${user.id.replace("usr_", "")}`,
            referrerUserId: referrer.id,
            referredUserId: user.id,
            name: family ? `${given} ${family[0]}.` : given,
            maskedEmail: `${user.email.slice(0, 3)}••••@${user.email.split("@")[1]}`,
            joinedAt: date(user.registeredAt),
            status:
              user.status === "active"
                ? user.totals.totalInvested > 0
                  ? ("active" as const)
                  : ("registered" as const)
                : ("inactive" as const),
            investedAmount: user.totals.totalInvested,
            earnedFromReferral: 0,
            tier: 1,
          },
        ];
      }),
  ];
  report.referrals = await insertAll(db, t.referrals, referralRows);

  const commissionRows = [
    ...adminCommissionLedger
      .filter((entry) => isSeeded(entry.beneficiaryUserId))
      .map((entry) => ({
        id: entry.id,
        beneficiaryUserId: entry.beneficiaryUserId,
        sourceUserId:
          seededUsers.find((user) => user.fullName === entry.sourceUserName)?.id ??
          null,
        sourceUserName: entry.sourceUserName,
        tier: entry.tier,
        amountUsdt: entry.amountUsdt,
        sourcePlanName: entry.sourcePlanName,
        createdAt: date(entry.createdAt),
        status: entry.status,
      })),
    // The demo account's remaining history, minus the two entries the CRM
    // ledger already records.
    ...commissionHistory
      .filter(
        (entry) =>
          !adminCommissionLedger.some(
            (existing) =>
              existing.beneficiaryUserId === DEMO_USER_ID &&
              isSameCommission(entry, existing),
          ),
      )
      .map((entry) => ({
        id: entry.id,
        beneficiaryUserId: DEMO_USER_ID,
        sourceUserId: null,
        sourceUserName: entry.referralName,
        tier: entry.tier,
        amountUsdt: entry.amount,
        sourcePlanName: entry.sourcePlan,
        createdAt: date(entry.date),
        status: "credited" as const,
      })),
  ];
  report.commission_entries = await insertAll(
    db,
    t.commissionEntries,
    commissionRows,
  );

  /* -------------------------------------------------------- Administration */

  report.admin_agents = await insertAll(
    db,
    t.adminAgents,
    adminAgents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      email: agent.email,
      role: agent.role,
      status: agent.status,
      createdAt: date(agent.createdAt),
      lastActiveAt: date(agent.lastActiveAt),
      note: agent.note ?? null,
      passwordResetRequestedAt: agent.passwordResetRequestedAt
        ? date(agent.passwordResetRequestedAt)
        : null,
    })),
  );

  report.admin_agent_permissions = await insertAll(
    db,
    t.adminAgentPermissions,
    adminAgents.flatMap((agent) =>
      Object.entries(agent.permissions).map(([permission, level]) => ({
        agentId: agent.id,
        permission: permission as (typeof t.adminPermissionEnum.enumValues)[number],
        level,
      })),
    ),
  );

  report.audit_logs = await insertAll(
    db,
    t.auditLogs,
    auditLogEntries
      .filter(
        (entry) =>
          // Entries about an account outside the dataset would link to a user
          // page that 404s. Non-user targets (plans, settings) always stay.
          entry.target?.type !== "user" || isSeeded(entry.target.id),
      )
      .map((entry) => ({
        id: entry.id,
        actorId: entry.actorId,
        actorName: entry.actorName,
        actorRole: entry.actorRole,
        action: entry.action,
        targetType: entry.target?.type ?? null,
        targetId: entry.target?.id ?? null,
        targetLabel: entry.target?.label ?? null,
        createdAt: date(entry.createdAt),
        ipAddress: entry.ipAddress,
        outcome: entry.outcome,
        details: entry.details,
      })),
  );

  report.notification_campaigns = await insertAll(
    db,
    t.notificationCampaigns,
    notificationCampaigns.map((campaign) => ({
      id: campaign.id,
      title: campaign.title,
      body: campaign.body,
      audience: campaign.audience,
      targetUserLabel: campaign.targetUserLabel,
      channels: campaign.channels,
      templateId: campaign.templateId,
      sentAt: date(campaign.sentAt),
      sentBy: campaign.sentBy,
      recipientCount: campaign.recipientCount,
      status: campaign.status,
    })),
  );

  report.platform_settings = await insertAll(db, t.platformSettings, [
    {
      id: "default",
      platform: platformSettings.platform,
      currency: platformSettings.currency,
      withdrawals: platformSettings.withdrawals,
      deposits: platformSettings.deposits,
      investments: platformSettings.investments,
      referrals: platformSettings.referrals,
      security: platformSettings.security,
      updatedAt: new Date(),
      updatedBy: null,
    },
  ]);

  return report;
}
