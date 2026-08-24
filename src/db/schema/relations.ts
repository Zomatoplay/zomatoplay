import { relations } from "drizzle-orm";

import { adminAgentPermissions, adminAgents } from "./admin";
import {
  notificationCategories,
  notifications,
  userNotificationPreferences,
} from "./engagement";
import { investments } from "./investments";
import { kycDocuments, kycNotes, kycSubmissions } from "./kyc";
import { deposits, transactions, withdrawals } from "./ledger";
import { plans } from "./plans";
import { commissionEntries, referralAccounts, referrals } from "./referrals";
import {
  bankAccounts,
  supportTickets,
  userDeviceSessions,
  userKycSteps,
  userSecurityEvents,
  users,
  walletAddresses,
  walletBalances,
} from "./users";

/**
 * Relational metadata for Drizzle's `db.query` API.
 *
 * Declared separately from the tables so the table modules stay free of
 * circular imports — `investments` needs `plans`, and a relation on `plans`
 * needs `investments` back.
 */

export const usersRelations = relations(users, ({ one, many }) => ({
  wallet: one(walletBalances, {
    fields: [users.id],
    references: [walletBalances.userId],
  }),
  referralAccount: one(referralAccounts, {
    fields: [users.id],
    references: [referralAccounts.userId],
  }),
  bankAccounts: many(bankAccounts),
  walletAddresses: many(walletAddresses),
  kycSteps: many(userKycSteps),
  kycSubmissions: many(kycSubmissions),
  investments: many(investments),
  transactions: many(transactions),
  deposits: many(deposits),
  withdrawals: many(withdrawals),
  notifications: many(notifications),
  notificationPreferences: many(userNotificationPreferences),
  deviceSessions: many(userDeviceSessions),
  securityEvents: many(userSecurityEvents),
  supportTickets: many(supportTickets),
}));

export const walletBalancesRelations = relations(walletBalances, ({ one }) => ({
  user: one(users, {
    fields: [walletBalances.userId],
    references: [users.id],
  }),
}));

export const bankAccountsRelations = relations(bankAccounts, ({ one }) => ({
  user: one(users, { fields: [bankAccounts.userId], references: [users.id] }),
}));

export const walletAddressesRelations = relations(walletAddresses, ({ one }) => ({
  user: one(users, { fields: [walletAddresses.userId], references: [users.id] }),
}));

export const userKycStepsRelations = relations(userKycSteps, ({ one }) => ({
  user: one(users, { fields: [userKycSteps.userId], references: [users.id] }),
}));

export const userDeviceSessionsRelations = relations(
  userDeviceSessions,
  ({ one }) => ({
    user: one(users, {
      fields: [userDeviceSessions.userId],
      references: [users.id],
    }),
  }),
);

export const userSecurityEventsRelations = relations(
  userSecurityEvents,
  ({ one }) => ({
    user: one(users, {
      fields: [userSecurityEvents.userId],
      references: [users.id],
    }),
  }),
);

export const supportTicketsRelations = relations(supportTickets, ({ one }) => ({
  user: one(users, { fields: [supportTickets.userId], references: [users.id] }),
}));

export const plansRelations = relations(plans, ({ many }) => ({
  investments: many(investments),
}));

export const investmentsRelations = relations(investments, ({ one }) => ({
  user: one(users, { fields: [investments.userId], references: [users.id] }),
  plan: one(plans, { fields: [investments.planId], references: [plans.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  user: one(users, { fields: [transactions.userId], references: [users.id] }),
}));

export const depositsRelations = relations(deposits, ({ one }) => ({
  user: one(users, { fields: [deposits.userId], references: [users.id] }),
}));

export const withdrawalsRelations = relations(withdrawals, ({ one }) => ({
  user: one(users, { fields: [withdrawals.userId], references: [users.id] }),
}));

export const kycSubmissionsRelations = relations(
  kycSubmissions,
  ({ one, many }) => ({
    user: one(users, { fields: [kycSubmissions.userId], references: [users.id] }),
    documents: many(kycDocuments),
    notes: many(kycNotes),
  }),
);

export const kycDocumentsRelations = relations(kycDocuments, ({ one }) => ({
  submission: one(kycSubmissions, {
    fields: [kycDocuments.submissionId],
    references: [kycSubmissions.id],
  }),
}));

export const kycNotesRelations = relations(kycNotes, ({ one }) => ({
  submission: one(kycSubmissions, {
    fields: [kycNotes.submissionId],
    references: [kycSubmissions.id],
  }),
}));

export const referralsRelations = relations(referrals, ({ one }) => ({
  referrer: one(users, {
    fields: [referrals.referrerUserId],
    references: [users.id],
    relationName: "referrer",
  }),
  referred: one(users, {
    fields: [referrals.referredUserId],
    references: [users.id],
    relationName: "referred",
  }),
}));

export const referralAccountsRelations = relations(referralAccounts, ({ one }) => ({
  user: one(users, {
    fields: [referralAccounts.userId],
    references: [users.id],
  }),
}));

export const commissionEntriesRelations = relations(
  commissionEntries,
  ({ one }) => ({
    beneficiary: one(users, {
      fields: [commissionEntries.beneficiaryUserId],
      references: [users.id],
      relationName: "beneficiary",
    }),
    source: one(users, {
      fields: [commissionEntries.sourceUserId],
      references: [users.id],
      relationName: "commissionSource",
    }),
  }),
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  categoryRef: one(notificationCategories, {
    fields: [notifications.category],
    references: [notificationCategories.id],
  }),
}));

export const userNotificationPreferencesRelations = relations(
  userNotificationPreferences,
  ({ one }) => ({
    user: one(users, {
      fields: [userNotificationPreferences.userId],
      references: [users.id],
    }),
    categoryRef: one(notificationCategories, {
      fields: [userNotificationPreferences.category],
      references: [notificationCategories.id],
    }),
  }),
);

export const adminAgentsRelations = relations(adminAgents, ({ many }) => ({
  permissions: many(adminAgentPermissions),
}));

export const adminAgentPermissionsRelations = relations(
  adminAgentPermissions,
  ({ one }) => ({
    agent: one(adminAgents, {
      fields: [adminAgentPermissions.agentId],
      references: [adminAgents.id],
    }),
  }),
);
