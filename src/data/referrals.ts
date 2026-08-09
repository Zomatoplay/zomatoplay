import type {
  CommissionEntry,
  Referral,
  ReferralSummary,
  VipLevel,
} from "@/types";

/**
 * Mock referral programme data.
 *
 * VIP thresholds and commission percentages are prototype values. They are
 * expressed as data rather than hard-coded in components so a future admin
 * console / config service can drive them.
 *
 * INTEGRATION POINT: replace with the referral service.
 */

export const vipLevels: VipLevel[] = [
  {
    id: "vip1",
    name: "VIP 1",
    tier1CommissionPercent: 3,
    tier2CommissionPercent: 1,
    requirements: {
      activeReferrals: 0,
      teamVolumeUsdt: 0,
    },
    benefits: [
      "3% commission on direct referral allocations",
      "1% commission on second-tier allocations",
      "Standard support response times",
    ],
  },
  {
    id: "vip2",
    name: "VIP 2",
    tier1CommissionPercent: 5,
    tier2CommissionPercent: 2,
    requirements: {
      activeReferrals: 5,
      teamVolumeUsdt: 5000,
    },
    benefits: [
      "5% commission on direct referral allocations",
      "2% commission on second-tier allocations",
      "Priority support queue",
      "Reduced withdrawal fees",
    ],
  },
  {
    id: "vip3",
    name: "VIP 3",
    tier1CommissionPercent: 8,
    tier2CommissionPercent: 3,
    requirements: {
      activeReferrals: 20,
      teamVolumeUsdt: 50000,
    },
    benefits: [
      "8% commission on direct referral allocations",
      "3% commission on second-tier allocations",
      "Dedicated account manager",
      "Zero withdrawal fees",
      "Early access to limited-capacity plans",
    ],
  },
];

export function getVipLevel(id: string): VipLevel | undefined {
  return vipLevels.find((level) => level.id === id);
}

export const referralSummary: ReferralSummary = {
  totalReferrals: 12,
  activeReferrals: 8,
  totalEarnings: 214.6,
  pendingEarnings: 18.25,
  teamVolume: 18400,
  currentLevel: "vip2",
  nextLevelProgress: 37,
};

export const referrals: Referral[] = [
  {
    id: "ref_1",
    name: "Priya M.",
    maskedEmail: "pri••••@gmail.com",
    joinedDate: "2026-07-28T00:00:00.000Z",
    status: "active",
    investedAmount: 2500,
    earnedFromReferral: 62.5,
    tier: 1,
  },
  {
    id: "ref_2",
    name: "Rohan K.",
    maskedEmail: "roh••••@outlook.com",
    joinedDate: "2026-07-11T00:00:00.000Z",
    status: "active",
    investedAmount: 1750,
    earnedFromReferral: 43.75,
    tier: 1,
  },
  {
    id: "ref_3",
    name: "Sneha D.",
    maskedEmail: "sne••••@gmail.com",
    joinedDate: "2026-06-30T00:00:00.000Z",
    status: "active",
    investedAmount: 1200,
    earnedFromReferral: 30,
    tier: 1,
  },
  {
    id: "ref_4",
    name: "Vikram S.",
    maskedEmail: "vik••••@yahoo.com",
    joinedDate: "2026-06-14T00:00:00.000Z",
    status: "active",
    investedAmount: 900,
    earnedFromReferral: 22.5,
    tier: 1,
  },
  {
    id: "ref_5",
    name: "Ananya R.",
    maskedEmail: "ana••••@gmail.com",
    joinedDate: "2026-05-29T00:00:00.000Z",
    status: "active",
    investedAmount: 3000,
    earnedFromReferral: 30,
    tier: 2,
  },
  {
    id: "ref_6",
    name: "Karan J.",
    maskedEmail: "kar••••@gmail.com",
    joinedDate: "2026-05-18T00:00:00.000Z",
    status: "inactive",
    investedAmount: 0,
    earnedFromReferral: 0,
    tier: 1,
  },
  {
    id: "ref_7",
    name: "Meera T.",
    maskedEmail: "mee••••@gmail.com",
    joinedDate: "2026-08-05T00:00:00.000Z",
    status: "registered",
    investedAmount: 0,
    earnedFromReferral: 0,
    tier: 1,
  },
  {
    id: "ref_8",
    name: "Arjun P.",
    maskedEmail: "arj••••@protonmail.com",
    joinedDate: "2026-04-22T00:00:00.000Z",
    status: "active",
    investedAmount: 1800,
    earnedFromReferral: 18,
    tier: 2,
  },
];

export const commissionHistory: CommissionEntry[] = [
  {
    id: "com_1",
    referralName: "Priya M.",
    date: "2026-08-02T18:30:00.000Z",
    amount: 12.5,
    tier: 1,
    sourcePlan: "Balanced Growth",
  },
  {
    id: "com_2",
    referralName: "Rohan K.",
    date: "2026-07-15T20:12:00.000Z",
    amount: 8.75,
    tier: 1,
    sourcePlan: "Balanced Growth",
  },
  {
    id: "com_3",
    referralName: "Ananya R.",
    date: "2026-07-04T10:02:00.000Z",
    amount: 6,
    tier: 2,
    sourcePlan: "Momentum Plan",
  },
  {
    id: "com_4",
    referralName: "Sneha D.",
    date: "2026-06-30T15:44:00.000Z",
    amount: 15,
    tier: 1,
    sourcePlan: "Momentum Plan",
  },
  {
    id: "com_5",
    referralName: "Vikram S.",
    date: "2026-06-14T09:18:00.000Z",
    amount: 22.5,
    tier: 1,
    sourcePlan: "Balanced Growth",
  },
  {
    id: "com_6",
    referralName: "Arjun P.",
    date: "2026-05-02T11:30:00.000Z",
    amount: 18,
    tier: 2,
    sourcePlan: "Starter Plan",
  },
];

export const referralSteps = [
  {
    title: "Share your link",
    description: "Send your personal invite link to friends via any app.",
  },
  {
    title: "They sign up and verify",
    description: "Your friend creates an account and completes KYC.",
  },
  {
    title: "They invest in a plan",
    description: "Commission is calculated on the amount they allocate.",
  },
  {
    title: "You earn commission",
    description:
      "Commission is credited to your available balance once their allocation settles.",
  },
];
