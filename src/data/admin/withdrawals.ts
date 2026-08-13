import {
  MOCK_USDT_INR_PAYOUT_RATE,
  WITHDRAWAL_FEE_PERCENT,
  WITHDRAWAL_FEE_USDT,
} from "@/constants/app";
import type { AdminWithdrawal, AdminWithdrawalStatus } from "@/types/admin";

/**
 * Mock withdrawal queue.
 *
 * Withdrawals settle in INR. Every record carries the rate that was quoted at
 * request time — deliberately distinct from the indicative display rate — plus
 * the full fee breakdown, so the admin screen can show exactly what the user
 * was promised.
 *
 * Fee arithmetic uses the platform constants rather than duplicating the
 * numbers, and the INR figure is derived from the record's own `payoutRate`.
 * Nothing here converts currency for display; that is `@/lib/currency`'s job.
 *
 * INTEGRATION POINT: replace with the payout rail's request queue.
 */

interface WithdrawalSeed {
  id: string;
  userId: string;
  userName: string;
  userDisplayId: string;
  amountUsdt: number;
  requestedAt: string;
  status: AdminWithdrawalStatus;
  destination: AdminWithdrawal["destination"];
  settledAt?: string | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
  payoutReference?: string | null;
  /** Older records were quoted at a different rate. */
  payoutRate?: number;
}

function withdrawal(seed: WithdrawalSeed): AdminWithdrawal {
  const rate = seed.payoutRate ?? MOCK_USDT_INR_PAYOUT_RATE;
  const percentFeeUsdt = (seed.amountUsdt * WITHDRAWAL_FEE_PERCENT) / 100;
  const totalFeeUsdt = WITHDRAWAL_FEE_USDT + percentFeeUsdt;
  const netUsdt = seed.amountUsdt - totalFeeUsdt;
  return {
    id: seed.id,
    userId: seed.userId,
    userName: seed.userName,
    userDisplayId: seed.userDisplayId,
    amountUsdt: seed.amountUsdt,
    payoutRate: rate,
    flatFeeUsdt: WITHDRAWAL_FEE_USDT,
    percentFeeUsdt,
    totalFeeUsdt,
    netInr: netUsdt * rate,
    destination: seed.destination,
    requestedAt: seed.requestedAt,
    settledAt: seed.settledAt ?? null,
    status: seed.status,
    reviewedBy: seed.reviewedBy ?? null,
    rejectionReason: seed.rejectionReason ?? null,
    payoutReference: seed.payoutReference ?? null,
  };
}

const hdfc = {
  label: "Primary account",
  bankName: "HDFC Bank",
  accountNumberMasked: "•••• •••• 4821",
  ifsc: "HDFC0001234",
  holderName: "Aarav Sharma",
};

export const adminWithdrawals: AdminWithdrawal[] = [
  withdrawal({
    id: "WD-90512",
    userId: "usr_3a72fc",
    userName: "Ananya Rao",
    userDisplayId: "NT-4820198",
    amountUsdt: 4000,
    requestedAt: "2026-08-09T07:52:00.000Z",
    status: "under_review",
    reviewedBy: "Rohit Malviya",
    destination: {
      label: "Salary account",
      bankName: "Axis Bank",
      accountNumberMasked: "•••• •••• 6612",
      ifsc: "UTIB0002210",
      holderName: "Ananya Rao",
    },
  }),
  withdrawal({
    id: "WD-90511",
    userId: "usr_5db417",
    userName: "Sneha Desai",
    userDisplayId: "NT-4820196",
    amountUsdt: 800,
    requestedAt: "2026-08-09T06:31:00.000Z",
    status: "pending",
    destination: {
      label: "Primary account",
      bankName: "ICICI Bank",
      accountNumberMasked: "•••• •••• 9037",
      ifsc: "ICIC0004567",
      holderName: "Sneha Desai",
    },
  }),
  withdrawal({
    id: "WD-90510",
    userId: "usr_2c5f19",
    userName: "Rahul Mehta",
    userDisplayId: "NT-4820207",
    amountUsdt: 1200,
    requestedAt: "2026-08-09T04:18:00.000Z",
    status: "pending",
    destination: {
      label: "Primary account",
      bankName: "State Bank of India",
      accountNumberMasked: "•••• •••• 3390",
      ifsc: "SBIN0011422",
      holderName: "Rahul Mehta",
    },
  }),
  withdrawal({
    id: "WD-90509",
    userId: "usr_4c8930",
    userName: "Devansh Gupta",
    userDisplayId: "NT-4820203",
    amountUsdt: 2200,
    requestedAt: "2026-08-08T18:44:00.000Z",
    status: "approved",
    reviewedBy: "Rohit Malviya",
    destination: {
      label: "Primary account",
      bankName: "Kotak Mahindra Bank",
      accountNumberMasked: "•••• •••• 5108",
      ifsc: "KKBK0007731",
      holderName: "Devansh Gupta",
    },
  }),
  withdrawal({
    id: "WD-90508",
    userId: "usr_59d1ca",
    userName: "Lakshmi Krishnan",
    userDisplayId: "NT-4820212",
    amountUsdt: 1500,
    requestedAt: "2026-08-08T12:09:00.000Z",
    status: "processing",
    reviewedBy: "Rohit Malviya",
    payoutReference: "NEFT-2026080812-44710",
    destination: {
      label: "Savings",
      bankName: "Indian Bank",
      accountNumberMasked: "•••• •••• 7742",
      ifsc: "IDIB000C144",
      holderName: "Lakshmi Krishnan",
    },
  }),
  withdrawal({
    id: "WD-90507",
    userId: "usr_e93028",
    userName: "Aditya Nair",
    userDisplayId: "NT-4820205",
    amountUsdt: 6000,
    requestedAt: "2026-08-07T10:26:00.000Z",
    status: "paid",
    settledAt: "2026-08-07T14:02:00.000Z",
    reviewedBy: "Priyanka Rane",
    payoutReference: "IMPS-2026080710-88201",
    destination: {
      label: "Primary account",
      bankName: "Federal Bank",
      accountNumberMasked: "•••• •••• 2065",
      ifsc: "FDRL0001288",
      holderName: "Aditya Nair",
    },
  }),
  withdrawal({
    id: "WD-90506",
    userId: "usr_6b2e84",
    userName: "Arjun Pillai",
    userDisplayId: "NT-4820201",
    amountUsdt: 900,
    requestedAt: "2026-08-06T15:37:00.000Z",
    status: "paid",
    settledAt: "2026-08-06T17:55:00.000Z",
    reviewedBy: "Priyanka Rane",
    payoutReference: "IMPS-2026080615-88044",
    destination: {
      label: "Primary account",
      bankName: "HDFC Bank",
      accountNumberMasked: "•••• •••• 1174",
      ifsc: "HDFC0000992",
      holderName: "Arjun Pillai",
    },
  }),
  withdrawal({
    id: "WD-90505",
    userId: "usr_a71c66",
    userName: "Nisha Verma",
    userDisplayId: "NT-4820204",
    amountUsdt: 500,
    requestedAt: "2026-08-04T09:14:00.000Z",
    status: "rejected",
    reviewedBy: "Rohit Malviya",
    rejectionReason:
      "Bank account holder name does not match the verified account name. Withdrawals frozen pending re-verification.",
    destination: {
      label: "Primary account",
      bankName: "Punjab National Bank",
      accountNumberMasked: "•••• •••• 8830",
      ifsc: "PUNB0221000",
      holderName: "N. Verma",
    },
  }),
  withdrawal({
    id: "WD-90504",
    userId: "usr_63c8f1",
    userName: "Gaurav Sinha",
    userDisplayId: "NT-4820217",
    amountUsdt: 1400,
    requestedAt: "2026-08-03T13:52:00.000Z",
    status: "paid",
    settledAt: "2026-08-03T16:18:00.000Z",
    reviewedBy: "Priyanka Rane",
    payoutReference: "NEFT-2026080313-87619",
    destination: {
      label: "Primary account",
      bankName: "Bank of Baroda",
      accountNumberMasked: "•••• •••• 4407",
      ifsc: "BARB0DBKANP",
      holderName: "Gaurav Sinha",
    },
  }),
  withdrawal({
    id: "WD-90503",
    userId: "usr_04ae83",
    userName: "Pooja Reddy",
    userDisplayId: "NT-4820210",
    amountUsdt: 450,
    requestedAt: "2026-08-01T11:08:00.000Z",
    status: "failed",
    reviewedBy: "Priyanka Rane",
    payoutReference: "IMPS-2026080111-87003",
    rejectionReason:
      "Payout returned by the beneficiary bank — account dormant. Funds restored to the user's balance.",
    destination: {
      label: "Savings",
      bankName: "Canara Bank",
      accountNumberMasked: "•••• •••• 6621",
      ifsc: "CNRB0002214",
      holderName: "Pooja Reddy",
    },
  }),
  withdrawal({
    id: "WD-90502",
    userId: "usr_1d7042",
    userName: "Suresh Balan",
    userDisplayId: "NT-4820223",
    amountUsdt: 2600,
    requestedAt: "2026-07-29T08:41:00.000Z",
    status: "paid",
    settledAt: "2026-07-29T11:26:00.000Z",
    reviewedBy: "Rohit Malviya",
    payoutRate: 82.4,
    payoutReference: "NEFT-2026072908-86412",
    destination: {
      label: "Primary account",
      bankName: "South Indian Bank",
      accountNumberMasked: "•••• •••• 0093",
      ifsc: "SIBL0000411",
      holderName: "Suresh Balan",
    },
  }),
  withdrawal({
    id: "WD-90501",
    userId: "usr_7f0d44",
    userName: "Ritu Malhotra",
    userDisplayId: "NT-4820214",
    amountUsdt: 700,
    requestedAt: "2026-07-26T17:19:00.000Z",
    status: "paid",
    settledAt: "2026-07-26T19:44:00.000Z",
    reviewedBy: "Priyanka Rane",
    payoutRate: 82.4,
    payoutReference: "IMPS-2026072617-86188",
    destination: {
      label: "Primary account",
      bankName: "Yes Bank",
      accountNumberMasked: "•••• •••• 5520",
      ifsc: "YESB0000221",
      holderName: "Ritu Malhotra",
    },
  }),
  withdrawal({
    id: "WD-90500",
    userId: "usr_8c41a2",
    userName: "Aarav Sharma",
    userDisplayId: "NT-4820193",
    amountUsdt: 1400,
    requestedAt: "2026-07-18T14:03:00.000Z",
    status: "paid",
    settledAt: "2026-07-18T16:37:00.000Z",
    reviewedBy: "Rohit Malviya",
    payoutRate: 82.4,
    payoutReference: "NEFT-2026071814-85220",
    destination: hdfc,
  }),
  withdrawal({
    id: "WD-90499",
    userId: "usr_20f5c3",
    userName: "Harsh Vardhan",
    userDisplayId: "NT-4820221",
    amountUsdt: 600,
    requestedAt: "2026-07-14T09:55:00.000Z",
    status: "paid",
    settledAt: "2026-07-14T12:11:00.000Z",
    reviewedBy: "Priyanka Rane",
    payoutRate: 82.4,
    payoutReference: "IMPS-2026071409-84903",
    destination: {
      label: "Primary account",
      bankName: "IDFC First Bank",
      accountNumberMasked: "•••• •••• 3012",
      ifsc: "IDFB0040101",
      holderName: "Harsh Vardhan",
    },
  }),
  withdrawal({
    id: "WD-90498",
    userId: "usr_ce2158",
    userName: "Farhan Qureshi",
    userDisplayId: "NT-4820215",
    amountUsdt: 400,
    requestedAt: "2026-07-08T20:32:00.000Z",
    status: "paid",
    settledAt: "2026-07-08T22:08:00.000Z",
    reviewedBy: "Priyanka Rane",
    payoutRate: 82.4,
    payoutReference: "IMPS-2026070820-84117",
    destination: {
      label: "Primary account",
      bankName: "Union Bank of India",
      accountNumberMasked: "•••• •••• 4005",
      ifsc: "UBIN0553417",
      holderName: "Farhan Qureshi",
    },
  }),
];

export function getAdminWithdrawalById(id: string): AdminWithdrawal | undefined {
  return adminWithdrawals.find((w) => w.id === id);
}

export function getWithdrawalsForUser(userId: string): AdminWithdrawal[] {
  return adminWithdrawals.filter((w) => w.userId === userId);
}

export const withdrawalStatusLabels: Record<AdminWithdrawalStatus, string> = {
  pending: "Pending",
  under_review: "Under review",
  approved: "Approved",
  processing: "Processing",
  paid: "Paid",
  rejected: "Rejected",
  failed: "Failed",
};

/** Reasons offered when rejecting a withdrawal. */
export const withdrawalRejectionReasons = [
  "Beneficiary name does not match the verified account holder.",
  "Bank account details could not be verified.",
  "KYC verification is incomplete or has expired.",
  "Account is under review following a security event.",
  "Requested amount exceeds the available balance.",
  "Suspected duplicate request.",
];
