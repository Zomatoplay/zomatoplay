import type {
  AdminNotificationAudience,
  AdminNotificationCampaign,
  AdminNotificationChannel,
  AdminNotificationTemplate,
} from "@/types/admin";

/**
 * Mock notification composer data.
 *
 * Nothing is delivered anywhere. "Sending" appends a campaign record and an
 * audit-log entry.
 *
 * INTEGRATION POINT: replace with the messaging service. `recipientCount` would
 * be resolved by the audience query rather than estimated here.
 */

export const notificationAudiences: {
  id: AdminNotificationAudience;
  label: string;
  description: string;
  /** Estimated size, so the composer can show reach before sending. */
  estimatedRecipients: number;
}[] = [
  {
    id: "single_user",
    label: "A single user",
    description: "Search for one user and message only them.",
    estimatedRecipients: 1,
  },
  {
    id: "all_users",
    label: "All users",
    description: "Everyone with an account, including inactive users.",
    estimatedRecipients: 2847,
  },
  {
    id: "kyc_pending",
    label: "KYC not completed",
    description: "Users who have started or not yet begun verification.",
    estimatedRecipients: 412,
  },
  {
    id: "kyc_approved",
    label: "Verified users",
    description: "Users whose verification has been approved.",
    estimatedRecipients: 2196,
  },
  {
    id: "active_investors",
    label: "Active investors",
    description: "Users with at least one running allocation.",
    estimatedRecipients: 1284,
  },
  {
    id: "inactive_users",
    label: "Inactive users",
    description: "No sign-in in the last 30 days.",
    estimatedRecipients: 508,
  },
  {
    id: "vip",
    label: "VIP 2 and above",
    description: "Users who have reached VIP 2 or VIP 3.",
    estimatedRecipients: 186,
  },
  {
    id: "blocked_users",
    label: "Blocked and suspended",
    description: "Accounts under a block or suspension.",
    estimatedRecipients: 34,
  },
];

export const notificationTemplates: AdminNotificationTemplate[] = [
  {
    id: "announcement",
    label: "Platform announcement",
    description: "General news, maintenance windows and product updates.",
    title: "Scheduled maintenance on Sunday",
    body: "We will be carrying out scheduled maintenance on Sunday between 02:00 and 04:00 IST. Deposits and withdrawals may be briefly unavailable during this window.",
    defaultAudience: "all_users",
  },
  {
    id: "kyc_reminder",
    label: "KYC reminder",
    description: "Nudge users who have not finished verification.",
    title: "Finish your verification",
    body: "Your account is not verified yet. Verification takes a couple of minutes and is required before you can invest or withdraw.",
    defaultAudience: "kyc_pending",
  },
  {
    id: "deposit_credited",
    label: "Deposit notification",
    description: "Confirm that a deposit has been credited.",
    title: "Your deposit has been credited",
    body: "Your USDT deposit has been confirmed on-chain and credited to your available balance.",
    defaultAudience: "single_user",
  },
  {
    id: "withdrawal_processed",
    label: "Withdrawal notification",
    description: "Confirm that an INR payout has been sent.",
    title: "Your withdrawal has been sent",
    body: "Your withdrawal has been approved and the INR payout has been sent to your bank account. It usually arrives within a few hours.",
    defaultAudience: "single_user",
  },
  {
    id: "investment_matured",
    label: "Investment notification",
    description: "Tell a user their allocation has matured.",
    title: "Your investment has matured",
    body: "Your allocation has reached the end of its term. Your principal and accrued rewards have been returned to your available balance.",
    defaultAudience: "active_investors",
  },
  {
    id: "custom",
    label: "Custom message",
    description: "Start from an empty message.",
    title: "",
    body: "",
    defaultAudience: "all_users",
  },
];

export const notificationCampaigns: AdminNotificationCampaign[] = [
  {
    id: "NTF-5081",
    title: "Finish your verification",
    body: "Your account is not verified yet. Verification takes a couple of minutes and is required before you can invest or withdraw.",
    audience: "kyc_pending",
    targetUserLabel: null,
    channels: ["in_app", "email"],
    templateId: "kyc_reminder",
    sentAt: "2026-08-08T10:30:00.000Z",
    sentBy: "Vivek Raghavan",
    recipientCount: 412,
    status: "sent",
  },
  {
    id: "NTF-5080",
    title: "New: Flexible Reserve now pays daily",
    body: "Rewards on the Flexible Reserve plan are now credited daily instead of weekly. Projected rates are unchanged and remain estimates, not guarantees.",
    audience: "active_investors",
    targetUserLabel: null,
    channels: ["in_app", "push"],
    templateId: "announcement",
    sentAt: "2026-08-06T14:00:00.000Z",
    sentBy: "Vivek Raghavan",
    recipientCount: 1284,
    status: "sent",
  },
  {
    id: "NTF-5079",
    title: "Your withdrawal has been sent",
    body: "Your withdrawal has been approved and the INR payout has been sent to your bank account.",
    audience: "single_user",
    targetUserLabel: "Aditya Nair · NT-4820205",
    channels: ["in_app", "email"],
    templateId: "withdrawal_processed",
    sentAt: "2026-08-07T14:05:00.000Z",
    sentBy: "Priyanka Rane",
    recipientCount: 1,
    status: "sent",
  },
  {
    id: "NTF-5078",
    title: "Scheduled maintenance on Sunday",
    body: "We will be carrying out scheduled maintenance on Sunday between 02:00 and 04:00 IST. Deposits and withdrawals may be briefly unavailable during this window.",
    audience: "all_users",
    targetUserLabel: null,
    channels: ["in_app", "email", "push"],
    templateId: "announcement",
    sentAt: "2026-08-04T09:15:00.000Z",
    sentBy: "Neel Varma",
    recipientCount: 2847,
    status: "sent",
  },
  {
    id: "NTF-5077",
    title: "We miss you — your account is still open",
    body: "You have not signed in for a while. Your balance and any running allocations are unaffected.",
    audience: "inactive_users",
    targetUserLabel: null,
    channels: ["email"],
    templateId: "custom",
    sentAt: "2026-07-30T11:00:00.000Z",
    sentBy: "Vivek Raghavan",
    recipientCount: 508,
    status: "sent",
  },
  {
    id: "NTF-5076",
    title: "VIP 3 benefits update",
    body: "VIP 3 members now get zero withdrawal fees and early access to limited-capacity plans.",
    audience: "vip",
    targetUserLabel: null,
    channels: ["in_app", "email"],
    templateId: "announcement",
    sentAt: "2026-07-22T16:40:00.000Z",
    sentBy: "Neel Varma",
    recipientCount: 186,
    status: "sent",
  },
  {
    id: "NTF-5075",
    title: "Your deposit has been credited",
    body: "Your USDT deposit has been confirmed on-chain and credited to your available balance.",
    audience: "single_user",
    targetUserLabel: "Devansh Gupta · NT-4820203",
    channels: ["in_app", "push"],
    templateId: "deposit_credited",
    sentAt: "2026-08-05T07:55:00.000Z",
    sentBy: "Rohit Malviya",
    recipientCount: 1,
    status: "sent",
  },
  {
    id: "NTF-5074",
    title: "Quarterly platform update",
    body: "A summary of what changed this quarter, including two new plans and faster INR payouts.",
    audience: "all_users",
    targetUserLabel: null,
    channels: ["email"],
    templateId: "announcement",
    sentAt: "2026-07-01T10:00:00.000Z",
    sentBy: "Neel Varma",
    recipientCount: 2610,
    status: "failed",
  },
];

export const notificationChannelLabels: Record<AdminNotificationChannel, string> =
  {
    in_app: "In-app",
    email: "Email",
    push: "Push",
  };

export function audienceLabel(id: AdminNotificationAudience): string {
  return notificationAudiences.find((a) => a.id === id)?.label ?? id;
}

export function audienceReach(id: AdminNotificationAudience): number {
  return notificationAudiences.find((a) => a.id === id)?.estimatedRecipients ?? 0;
}
