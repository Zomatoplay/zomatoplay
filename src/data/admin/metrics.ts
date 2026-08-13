import type {
  AdminFlowPoint,
  AdminMetrics,
  AdminSeriesPoint,
} from "@/types/admin";

/**
 * Mock dashboard aggregates and chart series.
 *
 * These describe the whole platform (a few thousand accounts), not just the
 * ~30 sample records in the other admin data modules — the tables are a
 * representative slice, the dashboard is the full picture. Keeping them
 * separate is deliberate: a real deployment computes these server-side rather
 * than by summing a page of rows on the client.
 *
 * INTEGRATION POINT: replace with `GET /admin/metrics` and the reporting
 * service's time series.
 */

export const adminMetrics: AdminMetrics = {
  totalUsers: 2847,
  activeUsers: 1962,
  newUsersThisMonth: 214,
  blockedUsers: 34,
  kycPending: 118,
  kycApproved: 2196,
  kycRejected: 47,
  totalDepositsUsdt: 1_284_600,
  pendingDeposits: 9,
  pendingDepositsUsdt: 4_180,
  totalWithdrawalsUsdt: 486_200,
  pendingWithdrawals: 6,
  pendingWithdrawalsUsdt: 12_400,
  totalInvestedUsdt: 819_600,
  activeInvestments: 1284,
  totalProfitUsdt: 74_820,
  referralCommissionsUsdt: 21_460,
};

/**
 * Money in vs money out, last 12 weeks.
 *
 * Rendered as a signed bar chart around a zero baseline — deposits above,
 * withdrawals below — so the primary encoding is position, not hue. The two
 * colours reinforce a polarity that the axis already communicates, which keeps
 * the series readable without relying on colour alone.
 */
export const platformFlowWeekly: AdminFlowPoint[] = [
  { label: "W20", inbound: 38200, outbound: 14100 },
  { label: "W21", inbound: 41800, outbound: 16400 },
  { label: "W22", inbound: 36400, outbound: 19200 },
  { label: "W23", inbound: 44900, outbound: 15800 },
  { label: "W24", inbound: 52300, outbound: 21600 },
  { label: "W25", inbound: 47100, outbound: 18900 },
  { label: "W26", inbound: 55800, outbound: 24200 },
  { label: "W27", inbound: 61200, outbound: 22700 },
  { label: "W28", inbound: 58400, outbound: 27300 },
  { label: "W29", inbound: 66900, outbound: 25100 },
  { label: "W30", inbound: 71400, outbound: 29800 },
  { label: "W31", inbound: 64200, outbound: 23400 },
];

/** New registrations per month, last 12 months. Single series. */
export const registrationsMonthly: AdminSeriesPoint[] = [
  { label: "Sep", value: 96 },
  { label: "Oct", value: 118 },
  { label: "Nov", value: 142 },
  { label: "Dec", value: 134 },
  { label: "Jan", value: 168 },
  { label: "Feb", value: 155 },
  { label: "Mar", value: 189 },
  { label: "Apr", value: 204 },
  { label: "May", value: 226 },
  { label: "Jun", value: 248 },
  { label: "Jul", value: 271 },
  { label: "Aug", value: 214 },
];

/** Total capital allocated across all live plans, month end. Single series. */
export const investedMonthly: AdminSeriesPoint[] = [
  { label: "Sep", value: 214000 },
  { label: "Oct", value: 268000 },
  { label: "Nov", value: 312000 },
  { label: "Dec", value: 356000 },
  { label: "Jan", value: 412000 },
  { label: "Feb", value: 468000 },
  { label: "Mar", value: 521000 },
  { label: "Apr", value: 584000 },
  { label: "May", value: 642000 },
  { label: "Jun", value: 708000 },
  { label: "Jul", value: 776000 },
  { label: "Aug", value: 819600 },
];

/**
 * The verification pipeline. Rendered as a proportion bar whose segments each
 * carry an icon, a label and a count — never colour alone.
 */
export const kycPipeline = [
  { id: "approved", label: "Approved", count: 2196 },
  { id: "pending", label: "Pending review", count: 118 },
  { id: "in_progress", label: "In progress", count: 294 },
  { id: "rejected", label: "Rejected", count: 47 },
  { id: "not_started", label: "Not started", count: 192 },
] as const;

/** Allocation split by plan, for the dashboard's plan mix panel. */
export const allocationByPlan: AdminSeriesPoint[] = [
  { label: "Momentum Plan", value: 312800 },
  { label: "Balanced Growth", value: 246500 },
  { label: "Institutional Plan", value: 180000 },
  { label: "Flexible Reserve", value: 48900 },
  { label: "Starter Plan", value: 31400 },
];
