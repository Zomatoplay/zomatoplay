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
    category: "deposit",
    status: "resolved",
    createdAt: "2026-07-27T16:10:00.000Z",
    updatedAt: "2026-07-27T17:40:00.000Z",
    messages: 4,
  },
  {
    id: "TKT-4906",
    subject: "Update my registered bank account",
    category: "account",
    status: "awaiting_reply",
    createdAt: "2026-08-04T09:30:00.000Z",
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
      "USDT is the platform's settlement currency, so every balance, investment and reward is held in USDT. INR amounts are shown alongside as an approximate local equivalent, converted at the USDT/INR rate set by Zomato Play, so you can gauge value at a glance. It is not a live market quote.",
  },
  {
    question: "How are withdrawals paid out?",
    answer:
      "You withdraw from your USDT balance and receive INR in your registered bank account. Before confirming, the app shows the withdrawal amount, the withdrawal rate, the withdrawal fee, and the exact INR amount you will receive.",
  },
  {
    question: "Do I need to complete KYC?",
    answer:
      "Yes. Identity verification is required before you can create an investment or withdraw funds. Our team reviews each submission by hand, so review times vary.",
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
    updated: "2026-10-02T00:00:00.000Z",
    sections: [
      {
        heading: "1. About these terms",
        body: `These terms govern your use of the ${APP_NAME} application and website. By creating an account or using the service you agree to them.`,
      },
      {
        heading: "2. Eligibility",
        body: "You must be at least 18 years old and legally permitted to use investment services where you live. Identity verification (KYC) is required before you can invest or withdraw.",
      },
      {
        heading: "3. Your account",
        body: "You sign in with your mobile number and a one-time code, and you set a separate withdrawal password. You are responsible for keeping your phone, codes and passwords secure, and for all activity under your account. We will never ask you for your one-time code or withdrawal password.",
      },
      {
        heading: "4. Deposits",
        body: "Deposits are made in USDT on the TRON (TRC-20) network, to the address and the exact amount shown when you start a deposit. A transfer that does not match what was shown, or that is sent on another network or in another token, may not be credited automatically and may be unrecoverable.",
      },
      {
        heading: "5. Investments",
        body: "Each plan states its term, minimum, reward schedule and risk level. Return figures are estimates and projections, not guarantees, and your capital is at risk.",
      },
      {
        heading: "6. Withdrawals, rates and fees",
        body: "Withdrawals are paid in INR to a bank account you have registered. The USDT/INR rates and the withdrawal fee are set by us, shown before you confirm, and applied to new requests; a request keeps the rate and fee quoted when you confirmed it. Withdrawals are reviewed before they are paid and are not instant.",
      },
      {
        heading: "7. Restrictions and security",
        body: "We may limit, suspend or close an account to protect customers, to investigate suspicious activity, or to meet legal obligations. Your balances and records are preserved while an account is restricted.",
      },
      {
        heading: "8. Referrals",
        body: "Referral commissions follow the programme rules shown in the application, are released on the schedule stated there, and may be withheld where we find misuse of the programme.",
      },
      {
        heading: "9. Changes and contact",
        body: "We may update these terms; material changes will be shown in the application before they take effect. For questions, use the Help centre in the app.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updated: "2026-10-02T00:00:00.000Z",
    sections: [
      {
        heading: "1. What we collect",
        body: "Your mobile number and the profile details you give us; identity documents and a live photo you submit for verification; the bank account you register for withdrawals (we store only a masked account number); your deposits, investments, withdrawals and referral activity; and technical data such as device type, IP address and approximate location, used for security.",
      },
      {
        heading: "2. How we use it",
        body: "To run your account and process your transactions, to verify your identity, to protect the service against fraud and abuse, to meet legal obligations, and to answer your support requests.",
      },
      {
        heading: "3. Who we share it with",
        body: "Service providers that help us operate the service — for example SMS sign-in verification (Google Firebase) and cloud hosting and storage (Amazon Web Services) — only as needed to provide it, and authorities where the law requires. We do not sell your personal data.",
      },
      {
        heading: "4. Verification documents",
        body: "Identity documents and photos are stored in a private store and opened only by authorised staff reviewing your verification.",
      },
      {
        heading: "5. Retention",
        body: "We keep your information while your account is active and for as long afterwards as the law or legitimate record-keeping requires.",
      },
      {
        heading: "6. Your choices",
        body: "You can ask to see, correct or delete your personal data by contacting support, subject to records we are required to keep.",
      },
    ],
  },
  risk: {
    title: "Risk Disclosure",
    updated: "2026-10-02T00:00:00.000Z",
    sections: [
      {
        heading: "Capital is at risk",
        body: "Investing involves risk. Digital-asset values can move sharply in either direction, and you may receive back less than you allocated.",
      },
      {
        heading: "Projections are not guarantees",
        body: "Every return figure shown in this application is an estimate or projection. Modelled or past performance is not a reliable indicator of future results, and no return is promised.",
      },
      {
        heading: "Lock-in periods",
        body: "Most plans lock your principal for a fixed term. You may be unable to access those funds early, or may have to forgo rewards or pay a fee to do so.",
      },
      {
        heading: "Currency risk",
        body: "Balances are held in USDT while withdrawals are paid in INR at the withdrawal rate shown when you confirm. The rates we use are set by us and can change; they are not a live market price.",
      },
      {
        heading: "Network and transfer risk",
        body: "Blockchain transfers are irreversible. Sending the wrong asset, using a different network from the one shown, or sending to a wrong address can result in permanent loss.",
      },
      {
        heading: "Regulatory risk",
        body: "Rules for digital assets differ by place and can change. You are responsible for understanding whether and how they apply to you.",
      },
    ],
  },
} as const;
