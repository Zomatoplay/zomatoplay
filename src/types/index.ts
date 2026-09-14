/**
 * Domain types for the Nanotron frontend.
 *
 * These are shaped like the payloads a real API would return, so the mock
 * modules in `@/data` can later be replaced by fetch calls without touching
 * component code. All monetary amounts are USDT unless a field name says
 * otherwise; INR values are always derived at render time via `@/lib/currency`.
 */

/* -------------------------------------------------------------------------- */
/* User & KYC                                                                  */
/* -------------------------------------------------------------------------- */

export type KycStatus =
  | "not_started"
  | "in_progress"
  | "pending_review"
  | "verified"
  | "rejected";

export type KycStepStatus = "complete" | "current" | "upcoming";

export interface KycStep {
  id: string;
  title: string;
  description: string;
  status: KycStepStatus;
}

export interface UserProfile {
  id: string;
  /** Public-facing member id shown in Settings. */
  displayId: string;
  fullName: string;
  email: string;
  phone: string;
  avatarUrl: string | null;
  country: string;
  memberSince: string;
  kycStatus: KycStatus;
  kycSteps: KycStep[];
  twoFactorEnabled: boolean;
  googleAuthEnabled: boolean;
  vipLevel: VipLevelId;
  referralCode: string;
}

/* -------------------------------------------------------------------------- */
/* Balances                                                                    */
/* -------------------------------------------------------------------------- */

export interface WalletBalance {
  available: number;
  totalDeposited: number;
  totalInvested: number;
  totalWithdrawn: number;
  totalProfit: number;
  /** Currently locked inside active investments. */
  lockedInInvestments: number;
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

export type RiskLevel = "conservative" | "balanced" | "growth";
export type PlanStatus = "open" | "limited" | "closed";
export type RewardFrequency = "daily" | "weekly" | "monthly" | "on_maturity";

export interface PlanHighlight {
  label: string;
  value: string;
}

export interface Plan {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** Long-form explanation rendered on the detail page. */
  howItWorks: string[];
  minInvestment: number;
  maxInvestment: number;
  durationDays: number;
  /** Estimated total return over the full term, as a percentage. Not guaranteed. */
  estimatedReturnPercent: number;
  /** Estimated return range, used to communicate uncertainty. */
  estimatedReturnRange: [number, number];
  rewardFrequency: RewardFrequency;
  risk: RiskLevel;
  status: PlanStatus;
  /** Optional capacity indicator for `limited` plans, 0–100. */
  capacityFilledPercent?: number;
  highlights: PlanHighlight[];
  conditions: string[];
  riskNotes: string[];
  /** Whether early exit is permitted, and on what terms. */
  earlyExit: string;
  popular?: boolean;
  /**
   * The plan's amount-banded rate ladder, lowest band first.
   *
   * Empty when the plan has no ladder, in which case
   * `estimatedReturnPercent` above is the rate every allocation is sold at.
   * A band's rate carries the same meaning as that field — projected **total**
   * return over the plan's whole term, never a periodic rate. See
   * `plan_rate_tiers` in the schema.
   *
   * Present on the public type because the plan screens show the ladder and
   * the invest sheet shows which band an amount falls into. That display is
   * an affordance only: `createInvestment` resolves the band again server-side
   * against the rows Postgres holds, and never trusts a rate from a browser.
   */
  rateTiers: PlanRateTierView[];
}

/** One band of a plan's rate ladder, as a screen reads it. */
export interface PlanRateTierView {
  id: string;
  /** Inclusive lower bound, in USDT. */
  minAmountUsdt: number;
  /** Exclusive upper bound. `null` on the open-ended top band. */
  maxAmountUsdt: number | null;
  /** Projected total return over the term for allocations in this band. */
  ratePercent: number;
  active: boolean;
}

/* -------------------------------------------------------------------------- */
/* Investments                                                                 */
/* -------------------------------------------------------------------------- */

export type InvestmentStatus = "active" | "completed" | "cancelled";

export interface Investment {
  id: string;
  planId: string;
  planName: string;
  amount: number;
  /** Profit accrued so far. */
  profit: number;
  /** Total profit projected at maturity. */
  projectedProfit: number;
  startDate: string;
  endDate: string;
  durationDays: number;
  elapsedDays: number;
  status: InvestmentStatus;
  rewardFrequency: RewardFrequency;
  /** ISO date of the next scheduled reward, or null when matured. */
  nextRewardDate: string | null;
  nextRewardAmount: number | null;
  risk: RiskLevel;
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                                */
/* -------------------------------------------------------------------------- */

export type TransactionType =
  | "deposit"
  | "withdrawal"
  | "investment"
  | "reward"
  | "referral";

export type TransactionStatus =
  | "completed"
  | "pending"
  | "processing"
  | "failed"
  | "cancelled";

export interface Transaction {
  id: string;
  type: TransactionType;
  /** Positive credits the wallet, negative debits it. */
  amount: number;
  /** Settlement currency of the movement. */
  currency: "USDT" | "INR";
  status: TransactionStatus;
  date: string;
  description: string;
  /** Blockchain reference for deposits, payout reference for withdrawals. */
  reference?: string;
  network?: DepositNetworkId;
  /** Confirmations observed / required — deposits only. */
  confirmations?: { current: number; required: number };
  /** INR amount actually paid out — withdrawals only. */
  inrAmount?: number;
  feeUsdt?: number;
}

/* -------------------------------------------------------------------------- */
/* Deposits                                                                    */
/* -------------------------------------------------------------------------- */

export type DepositNetworkId = "trc20" | "erc20" | "bep20" | "polygon";

export interface DepositNetwork {
  id: DepositNetworkId;
  name: string;
  chain: string;
  /** Mock address — not a real wallet. */
  address: string;
  minDeposit: number;
  estimatedArrival: string;
  requiredConfirmations: number;
  networkFeeNote: string;
  recommended?: boolean;
}

export type DepositFlowStage =
  | "select_network"
  | "show_address"
  | "awaiting_transfer"
  | "detected"
  | "confirming"
  | "credited";

/* -------------------------------------------------------------------------- */
/* Withdrawals                                                                 */
/* -------------------------------------------------------------------------- */

export interface BankAccount {
  id: string;
  label: string;
  bankName: string;
  accountNumberMasked: string;
  ifsc: string;
  holderName: string;
  isDefault: boolean;
}

export interface SavedWalletAddress {
  id: string;
  label: string;
  network: DepositNetworkId;
  address: string;
  isDefault: boolean;
}

export interface WithdrawalQuote {
  amountUsdt: number;
  flatFeeUsdt: number;
  percentFeeUsdt: number;
  totalFeeUsdt: number;
  netUsdt: number;
  rate: number;
  netInr: number;
}

/* -------------------------------------------------------------------------- */
/* Earnings                                                                    */
/* -------------------------------------------------------------------------- */

export interface EarningsPoint {
  /** Short axis label, e.g. `Mon` or `Mar`. */
  label: string;
  value: number;
}

export interface EarningsSummary {
  thisWeek: number;
  thisMonth: number;
  lastMonth: number;
  total: number;
  /** Change vs the previous comparable period, as a percentage. */
  weekChangePercent: number;
  monthChangePercent: number;
  weekly: EarningsPoint[];
  monthly: EarningsPoint[];
}

/* -------------------------------------------------------------------------- */
/* Referrals                                                                   */
/* -------------------------------------------------------------------------- */

export type VipLevelId = "vip1" | "vip2" | "vip3";

export interface VipLevel {
  id: VipLevelId;
  name: string;
  /** Level 1 commission on a referral's investment, as a percentage. */
  tier1CommissionPercent: number;
  /** Level 2 (sub-referral) commission, as a percentage. */
  tier2CommissionPercent: number;
  requirements: {
    activeReferrals: number;
    teamVolumeUsdt: number;
  };
  benefits: string[];
}

export type ReferralStatus = "active" | "registered" | "inactive";

export interface Referral {
  id: string;
  name: string;
  /** Partially masked for privacy, as a real product would. */
  maskedEmail: string;
  joinedDate: string;
  status: ReferralStatus;
  /** Total the referral has invested. */
  investedAmount: number;
  /** Commission this referral has generated for the user. */
  earnedFromReferral: number;
  tier: 1 | 2;
}

export interface CommissionEntry {
  id: string;
  referralName: string;
  date: string;
  amount: number;
  tier: 1 | 2;
  sourcePlan: string;
}

export interface ReferralSummary {
  totalReferrals: number;
  activeReferrals: number;
  totalEarnings: number;
  pendingEarnings: number;
  teamVolume: number;
  currentLevel: VipLevelId;
  /** Progress toward the next level, 0–100. Null when already at the top. */
  nextLevelProgress: number | null;
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export type NotificationCategory =
  | "deposit"
  | "withdrawal"
  | "investment"
  | "profit"
  | "referral"
  | "announcement";

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  body: string;
  date: string;
  read: boolean;
}

export interface NotificationPreference {
  id: NotificationCategory;
  label: string;
  description: string;
  enabled: boolean;
}

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

export interface SecurityActivity {
  id: string;
  event: string;
  device: string;
  location: string;
  date: string;
  status: "success" | "blocked";
}

/* -------------------------------------------------------------------------- */
/* Support                                                                     */
/* -------------------------------------------------------------------------- */

export type TicketStatus = "open" | "awaiting_reply" | "resolved";

export interface SupportTicket {
  id: string;
  subject: string;
  status: TicketStatus;
  updatedAt: string;
  messages: number;
}

export interface FaqItem {
  question: string;
  answer: string;
}
