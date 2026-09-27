import type {
  BankAccount,
  SavedWalletAddress,
  SecurityActivity,
  UserProfile,
  WalletBalance,
} from "@/types";

/**
 * Mock user + wallet data.
 *
 * INTEGRATION POINT: replace these exports with API/database reads. Component
 * code imports the values, never the literals, so the swap is mechanical.
 */

export const currentUser: UserProfile = {
  id: "usr_8c41a2",
  displayId: "NT-4820193",
  fullName: "Aarav Sharma",
  email: "aarav.sharma@example.com",
  phone: "+91 98••• ••210",
  phoneVerified: false,
  avatarUrl: null,
  country: "India",
  memberSince: "2025-11-14T00:00:00.000Z",
  kycStatus: "not_started",
  kycSteps: [
    {
      id: "personal",
      title: "Personal details",
      description: "Legal name, date of birth and residential address.",
      status: "current",
    },
    {
      id: "document",
      title: "Identity document",
      description: "Upload a government-issued photo ID.",
      status: "upcoming",
    },
    {
      id: "selfie",
      title: "Liveness check",
      description: "Take a short selfie video to confirm it is you.",
      status: "upcoming",
    },
    {
      id: "review",
      title: "Review",
      description: "We verify your submission. Usually within 24 hours.",
      status: "upcoming",
    },
  ],
  twoFactorEnabled: false,
  googleAuthEnabled: false,
  vipLevel: "vip2",
  referralCode: "AARAV4820",
};

export const walletBalance: WalletBalance = {
  available: 1250,
  totalDeposited: 6800,
  totalInvested: 5200,
  totalWithdrawn: 1400,
  totalProfit: 842.35,
  lockedInInvestments: 3900,
};

export const savedBankAccounts: BankAccount[] = [
  {
    id: "bank_1",
    label: "Primary account",
    bankName: "HDFC Bank",
    accountNumberMasked: "•••• •••• 4821",
    ifsc: "HDFC0001234",
    holderName: "Aarav Sharma",
    isDefault: true,
  },
  {
    id: "bank_2",
    label: "Savings",
    bankName: "ICICI Bank",
    accountNumberMasked: "•••• •••• 9037",
    ifsc: "ICIC0004567",
    holderName: "Aarav Sharma",
    isDefault: false,
  },
];

export const savedWalletAddresses: SavedWalletAddress[] = [
  {
    id: "addr_1",
    label: "Main wallet",
    network: "trc20",
    address: "TQ5nR8xWvKp2mYdL7fJhA3cVbN9tGsE4Uz",
    isDefault: true,
  },
  {
    id: "addr_2",
    label: "Backup wallet",
    network: "bep20",
    address: "0x7fA2c94BdE13a05C8f6b271Da9E4C3b8A1d05e62",
    isDefault: false,
  },
];

export const securityActivity: SecurityActivity[] = [
  {
    id: "sec_1",
    event: "Signed in",
    device: "iPhone 15 · Safari",
    location: "Mumbai, IN",
    date: "2026-08-09T04:12:00.000Z",
    status: "success",
  },
  {
    id: "sec_2",
    event: "Password changed",
    device: "iPhone 15 · Safari",
    location: "Mumbai, IN",
    date: "2026-08-02T09:40:00.000Z",
    status: "success",
  },
  {
    id: "sec_3",
    event: "Sign-in attempt blocked",
    device: "Unknown · Chrome",
    location: "Frankfurt, DE",
    date: "2026-07-28T22:05:00.000Z",
    status: "blocked",
  },
  {
    id: "sec_4",
    event: "Withdrawal address added",
    device: "MacBook Air · Chrome",
    location: "Mumbai, IN",
    date: "2026-07-19T11:22:00.000Z",
    status: "success",
  },
];
