import {
  APP_NAME,
  APP_TAGLINE,
  MIN_DEPOSIT_USDT,
  MIN_WITHDRAWAL_USDT,
  MOCK_RATE_LABEL,
  MOCK_USDT_INR_PAYOUT_RATE,
  MOCK_USDT_INR_RATE,
  SUPPORT_EMAIL,
  WITHDRAWAL_FEE_PERCENT,
  WITHDRAWAL_FEE_USDT,
  WITHDRAWAL_PROCESSING_WINDOW,
} from "@/constants/app";
import type { PlatformSettings } from "@/types/admin";

/**
 * Seed platform configuration.
 *
 * Every value is read from `@/constants/app` rather than retyped, so the
 * settings screen shows what the user application is actually running on.
 * Editing it in the CRM changes the in-memory admin store only — the running
 * user app still reads the constants, because a prototype has no config
 * service to propagate through.
 *
 * INTEGRATION POINT: replace with a configuration service. `getUsdtInrRate()`
 * in `@/lib/currency` would then read the stored rate instead of the constant,
 * and these controls would become the write side of that service.
 */

export const platformSettings: PlatformSettings = {
  platform: {
    name: APP_NAME,
    tagline: APP_TAGLINE,
    supportEmail: SUPPORT_EMAIL,
    supportHours: "Mon–Sat, 09:00–19:00 IST",
    maintenanceMode: false,
    registrationsOpen: true,
  },
  currency: {
    displayRate: MOCK_USDT_INR_RATE,
    payoutRate: MOCK_USDT_INR_PAYOUT_RATE,
    rateLabel: MOCK_RATE_LABEL,
  },
  withdrawals: {
    minimumUsdt: MIN_WITHDRAWAL_USDT,
    flatFeeUsdt: WITHDRAWAL_FEE_USDT,
    percentFee: WITHDRAWAL_FEE_PERCENT,
    processingWindow: WITHDRAWAL_PROCESSING_WINDOW,
    manualReviewThresholdUsdt: 2000,
    requireKyc: true,
  },
  deposits: {
    minimumUsdt: MIN_DEPOSIT_USDT,
    autoCreditEnabled: true,
  },
  investments: {
    requireKyc: true,
    maxActivePerUser: 10,
    allowEarlyExit: true,
  },
  referrals: {
    programmeEnabled: true,
    payoutDelayDays: 3,
    maxTiers: 2,
  },
  security: {
    requireTwoFactorForAgents: true,
    sessionTimeoutMinutes: 30,
    maxFailedLogins: 5,
    ipAllowlistEnabled: false,
  },
};
