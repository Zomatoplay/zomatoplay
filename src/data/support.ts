import { APP_NAME } from "@/constants/app";
import type { FaqItem, SupportTicket } from "@/types";

/**
 * Mock support content.
 * INTEGRATION POINT: replace FAQs with a CMS read and tickets with the
 * helpdesk API.
 */

export const supportTickets: SupportTicket[] = [
  {
    id: "TKT-4821",
    subject: "Deposit not showing after 30 minutes",
    status: "resolved",
    updatedAt: "2026-07-27T17:40:00.000Z",
    messages: 4,
  },
  {
    id: "TKT-4906",
    subject: "Update my registered bank account",
    status: "awaiting_reply",
    updatedAt: "2026-08-05T10:12:00.000Z",
    messages: 2,
  },
];

export const faqs: FaqItem[] = [
  {
    question: "Which currency can I deposit?",
    answer:
      "Deposits are accepted in USDT only. You choose a network, send USDT to the address shown, and your balance updates once the required number of network confirmations is reached.",
  },
  {
    question: "Why do I see both USDT and INR amounts?",
    answer:
      "USDT is the platform's settlement currency, so every balance, investment and reward is held in USDT. INR amounts are shown alongside as an approximate local equivalent using an indicative rate, so you can gauge value at a glance. The INR figure is not a live market quote.",
  },
  {
    question: "How are withdrawals paid out?",
    answer:
      "You withdraw from your USDT balance and receive INR in your registered bank account. Before confirming, the app shows the withdrawal amount, the quoted payout rate, any fees, and the exact INR amount you will receive.",
  },
  {
    question: "Do I need to complete KYC?",
    answer:
      "Yes. Identity verification is required before you can create an investment or withdraw funds. It normally takes under 24 hours once you have submitted your documents.",
  },
  {
    question: "Are the projected returns guaranteed?",
    answer:
      "No. All return figures shown on plans are estimates or projections based on strategy modelling. Actual results vary with market conditions and your capital is at risk.",
  },
  {
    question: "Can I withdraw an investment before it matures?",
    answer:
      "It depends on the plan. Each plan's detail page states its early-exit terms — some allow exit after a minimum period with a fee or forfeited rewards, and others are locked until maturity.",
  },
  {
    question: "How does the referral programme work?",
    answer:
      "Share your invite link. When someone signs up through it, verifies their identity and allocates to a plan, you earn a commission based on your VIP level. Commissions are credited to your available balance.",
  },
  {
    question: "What happens if I send the wrong token or use the wrong network?",
    answer:
      "Only send USDT on the exact network you selected. Funds sent as a different token, or on a different network, cannot be automatically credited and may be unrecoverable.",
  },
];

export const helpTopics = [
  { id: "deposits", title: "Deposits", description: "Networks, confirmations and troubleshooting" },
  { id: "withdrawals", title: "Withdrawals", description: "Payouts, rates, fees and timings" },
  { id: "investments", title: "Investments", description: "Plans, rewards, maturity and early exit" },
  { id: "kyc", title: "Verification", description: "Documents, review times and rejections" },
  { id: "security", title: "Account & security", description: "Passwords, 2FA and device activity" },
  { id: "referrals", title: "Referrals", description: "Invite links, commissions and VIP levels" },
];

export const legalDocuments = {
  terms: {
    title: "Terms & Conditions",
    updated: "2026-06-01T00:00:00.000Z",
    sections: [
      {
        heading: "1. About these terms",
        body: `These terms govern your use of the ${APP_NAME} application.`,
      },
      {
        heading: "2. Eligibility",
        body: "You must be at least 18 years old and legally permitted to use investment services in your jurisdiction. Identity verification is required before investing or withdrawing.",
      },
      {
        heading: "3. Your account",
        body: "You are responsible for keeping your credentials and two-factor codes secure, and for all activity that occurs under your account.",
      },
      {
        heading: "4. Investments",
        body: "Return figures presented in the application are estimates and projections. They are not guarantees, forecasts of certain outcomes, or a promise of any particular result.",
      },
      {
        heading: "5. Fees",
        body: "Applicable fees are disclosed in the application before you confirm a transaction. Network fees charged by third-party blockchains are outside our control.",
      },
      {
        heading: "6. Changes",
        body: "We may update these terms. Material changes will be notified in the application before they take effect.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "2026-06-01T00:00:00.000Z",
    sections: [
      {
        heading: "1. What we collect",
        body: "Account details you provide, verification documents you submit, and technical data such as device type and approximate location used for security.",
      },
      {
        heading: "2. How we use it",
        body: "To operate your account, meet verification and regulatory obligations, detect fraud, and provide support.",
      },
      {
        heading: "3. Sharing",
        body: "We share data with verification and payment providers strictly as needed to deliver the service, and with authorities where legally required.",
      },
      {
        heading: "4. Retention",
        body: "Verification records are retained for the period required by applicable regulation, then deleted.",
      },
      {
        heading: "5. Your rights",
        body: "You may request access to, correction of, or deletion of your personal data, subject to legal retention requirements.",
      },
    ],
  },
  risk: {
    title: "Risk Disclosure",
    updated: "2026-06-01T00:00:00.000Z",
    sections: [
      {
        heading: "Capital is at risk",
        body: "Investing involves risk. The value of digital assets can move sharply in either direction, and you may receive back less than you allocated.",
      },
      {
        heading: "Projections are not guarantees",
        body: "Every return figure shown in this application is an estimate or projection. Past or modelled performance is not a reliable indicator of future results.",
      },
      {
        heading: "Lock-in periods",
        body: "Most plans lock your principal for a fixed term. You may be unable to access those funds early, or may incur a fee to do so.",
      },
      {
        heading: "Currency risk",
        body: "Balances are held in USDT while withdrawals are paid in INR. Movements in the USDT/INR rate between investing and withdrawing will affect the amount you receive.",
      },
      {
        heading: "Network risk",
        body: "Blockchain transfers are irreversible. Sending the wrong asset, or using a network other than the one selected, can result in permanent loss.",
      },
    ],
  },
} as const;
