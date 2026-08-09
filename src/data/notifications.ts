import type { AppNotification, NotificationPreference } from "@/types";

/**
 * Mock notifications and notification preferences.
 * INTEGRATION POINT: replace with the notifications service.
 */

export const notifications: AppNotification[] = [
  {
    id: "ntf_1",
    category: "profit",
    title: "Weekly reward credited",
    body: "23.40 USDT from Balanced Growth has been added to your available balance.",
    date: "2026-08-06T09:15:00.000Z",
    read: false,
  },
  {
    id: "ntf_2",
    category: "deposit",
    title: "Deposit confirmed",
    body: "Your 500.00 USDT deposit on TRC20 has been fully confirmed and credited.",
    date: "2026-08-04T14:06:00.000Z",
    read: false,
  },
  {
    id: "ntf_3",
    category: "withdrawal",
    title: "Withdrawal is processing",
    body: "Your withdrawal of 300.00 USDT to HDFC •••• 4821 is being processed.",
    date: "2026-08-03T11:50:00.000Z",
    read: true,
  },
  {
    id: "ntf_4",
    category: "referral",
    title: "New referral commission",
    body: "You earned 12.50 USDT from Priya M.'s allocation.",
    date: "2026-08-02T18:30:00.000Z",
    read: true,
  },
  {
    id: "ntf_5",
    category: "announcement",
    title: "Momentum Plan capacity is filling up",
    body: "The current Momentum Plan cohort is 78% allocated.",
    date: "2026-07-31T08:00:00.000Z",
    read: true,
  },
  {
    id: "ntf_6",
    category: "investment",
    title: "Investment started",
    body: "Your 1,200.00 USDT allocation to Momentum Plan is now active.",
    date: "2026-07-28T10:05:00.000Z",
    read: true,
  },
];

export const notificationPreferences: NotificationPreference[] = [
  {
    id: "deposit",
    label: "Deposits",
    description: "Detection, confirmations and credited deposits.",
    enabled: true,
  },
  {
    id: "withdrawal",
    label: "Withdrawals",
    description: "Requests, processing updates and payouts.",
    enabled: true,
  },
  {
    id: "investment",
    label: "Investments",
    description: "Allocations, maturity reminders and plan changes.",
    enabled: true,
  },
  {
    id: "profit",
    label: "Profits & rewards",
    description: "Reward credits and profit summaries.",
    enabled: true,
  },
  {
    id: "referral",
    label: "Referrals",
    description: "New sign-ups, commissions and VIP level changes.",
    enabled: false,
  },
  {
    id: "announcement",
    label: "Platform announcements",
    description: "New plans, maintenance windows and product news.",
    enabled: true,
  },
];

export const unreadNotificationCount = notifications.filter((n) => !n.read).length;
