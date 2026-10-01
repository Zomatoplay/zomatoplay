import type {
  AdminPermissionDescriptor,
  AdminPermissionSet,
} from "@/types/admin";

/**
 * Master CRM configuration.
 *
 * Kept separate from `@/constants/app` (the user application) so the two areas
 * never share navigation or configuration by accident.
 *
 * Deliberately free of any UI import: the seed data in `@/data/admin` reads the
 * permission catalogue below, and the server layer reads the seed data. The
 * navigation, which needs an icon per entry, lives in
 * `@/constants/admin-navigation`.
 */

import { APP_NAME } from "./app";

export const ADMIN_APP_NAME = APP_NAME;
export const ADMIN_APP_SUBTITLE = "Master CRM";

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The permission catalogue. Order is the order the matrix renders in.
 *
 * INTEGRATION POINT: this list is the contract the backend authorization layer
 * must implement. Route handlers should check the same ids.
 */
export const ADMIN_PERMISSIONS: AdminPermissionDescriptor[] = [
  {
    id: "users",
    label: "Users",
    description: "Browse and search the user directory.",
    manageHint: "Edit profiles, block, suspend and deactivate accounts.",
  },
  {
    id: "user_details",
    label: "User details",
    description: "Open an individual user's full profile and history.",
    manageHint: "Reset passwords and 2FA, and change account restrictions.",
  },
  {
    id: "kyc",
    label: "KYC",
    description: "View verification submissions and documents.",
    manageHint: "Approve, reject and request resubmission.",
  },
  {
    id: "deposits",
    label: "Deposits",
    description: "View incoming deposits and their confirmation state.",
    manageHint: "Credit confirmed deposits and mark deposits failed.",
  },
  {
    id: "withdrawals",
    label: "Withdrawals",
    description: "View withdrawal requests and payout details.",
    manageHint: "Approve, reject and mark withdrawals paid.",
  },
  {
    id: "investments",
    label: "Investments",
    description: "View every allocation on the platform.",
    manageHint: "Cancel allocations and adjust reward schedules.",
  },
  {
    id: "plans",
    label: "Plans",
    description: "View the investment plan catalogue.",
    manageHint: "Create, edit, disable and re-open plans.",
  },
  {
    id: "referrals",
    label: "Referrals",
    description: "View referral trees, VIP levels and commission history.",
    manageHint: "Adjust commissions and reverse incorrect payouts.",
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "View sent notifications and announcements.",
    manageHint: "Send notifications to users, groups and the whole platform.",
  },
  {
    id: "audit_logs",
    label: "Audit logs",
    description: "Read the record of administrative actions.",
    manageHint: "Export the audit trail.",
  },
  {
    id: "settings",
    label: "Settings",
    description: "View platform configuration.",
    manageHint: "Change currency, fee, investment and referral configuration.",
  },
  {
    id: "security",
    label: "Security",
    description: "View user devices, sessions and security events.",
    manageHint:
      "Revoke sessions, force sign-out across devices and reset withdrawal passwords.",
  },
  {
    id: "agents",
    label: "Agent management",
    description: "View the agent directory and their activity.",
    manageHint: "Create agents, assign permissions and reset their passwords.",
  },
  {
    id: "wallet_credits",
    label: "Manual wallet credits",
    description: "View the history of manual USDT credits.",
    manageHint:
      "Credit USDT to a customer's wallet by hand. Grant sparingly — it creates money on the ledger.",
  },
];

export const ADMIN_PERMISSION_IDS = ADMIN_PERMISSIONS.map((p) => p.id);

/** Every permission at the given level — the base for building a new agent. */
export function buildPermissionSet(
  level: "none" | "view" | "manage",
): AdminPermissionSet {
  return Object.fromEntries(
    ADMIN_PERMISSION_IDS.map((id) => [id, level]),
  ) as AdminPermissionSet;
}

/**
 * Starting points offered when creating an agent. Real teams almost never
 * hand-pick 14 toggles from scratch.
 */
export const AGENT_PRESETS: {
  id: string;
  label: string;
  description: string;
  permissions: AdminPermissionSet;
}[] = [
  {
    id: "support",
    label: "Support",
    description: "Read-only across the platform. Cannot approve or change anything.",
    permissions: {
      ...buildPermissionSet("view"),
      settings: "none",
      agents: "none",
      audit_logs: "none",
      wallet_credits: "none",
    },
  },
  {
    id: "compliance",
    label: "Compliance",
    description: "Runs KYC review and can act on user accounts and security.",
    permissions: {
      ...buildPermissionSet("view"),
      kyc: "manage",
      user_details: "manage",
      security: "manage",
      plans: "none",
      settings: "none",
      agents: "none",
      wallet_credits: "none",
    },
  },
  {
    id: "finance",
    label: "Finance",
    description: "Processes deposits and withdrawals; no user administration.",
    permissions: {
      ...buildPermissionSet("view"),
      deposits: "manage",
      withdrawals: "manage",
      referrals: "manage",
      settings: "none",
      agents: "none",
      security: "none",
      // Can see the credit history; crediting is granted to a person, never
      // by preset.
      wallet_credits: "view",
    },
  },
  {
    id: "operations",
    label: "Operations",
    description: "Manages plans, investments and platform notifications.",
    permissions: {
      ...buildPermissionSet("view"),
      plans: "manage",
      investments: "manage",
      notifications: "manage",
      agents: "none",
      wallet_credits: "none",
    },
  },
  {
    id: "custom",
    label: "Custom",
    description: "Start with nothing and assign each permission by hand.",
    permissions: buildPermissionSet("none"),
  },
];

/* -------------------------------------------------------------------------- */
/* Table / list configuration                                                  */
/* -------------------------------------------------------------------------- */

/** Rows per page in the CRM tables. */
export const ADMIN_PAGE_SIZE = 10;

/** Fixed "now" for the prototype, so relative labels never drift per render. */
export const ADMIN_NOW = "2026-08-09T09:00:00.000Z";

/* -------------------------------------------------------------------------- */
/* List screen specs — what each CRM list accepts from its URL                 */
/* -------------------------------------------------------------------------- */

/**
 * One spec per paginated list screen.
 *
 * These are the allowlists `parseAdminListQuery` validates against, and the
 * vocabularies the filter controls render from — deliberately the same object,
 * so a token an operator can click is by construction one the query accepts.
 *
 * `statuses` mirrors the screen's own enum plus `"all"`. They are written out
 * rather than derived from `@/db/schema/enums` on purpose: this file is
 * imported by client components, and the schema is not something the browser
 * bundle should carry.
 */
export const ADMIN_LIST_SPECS = {
  users: {
    statuses: ["all", "active", "inactive", "blocked", "suspended", "deactivated"],
    sorts: ["recent", "oldest", "name", "balance", "active"],
    defaultStatus: "all",
    defaultSort: "recent",
  },
  kyc: {
    statuses: [
      "all",
      "pending",
      "under_review",
      "approved",
      "rejected",
      "resubmission_requested",
    ],
    sorts: ["recent", "oldest"],
    defaultStatus: "all",
    defaultSort: "recent",
  },
  deposits: {
    statuses: [
      "all",
      /*
       * Not a column value: confirmed transfers with no account — the queue an
       * operator works. The repository translates it (`pageAdminDeposits`).
       */
      "unmatched",
      "pending",
      "detected",
      "confirming",
      "confirmed",
      "credited",
      "failed",
      "ignored",
    ],
    sorts: ["recent", "oldest", "amount"],
    defaultStatus: "all",
    defaultSort: "recent",
  },
  withdrawals: {
    statuses: [
      "all",
      "pending",
      "under_review",
      "approved",
      "processing",
      "paid",
      "rejected",
      "failed",
    ],
    sorts: ["recent", "oldest", "amount"],
    defaultStatus: "all",
    defaultSort: "recent",
  },
  investments: {
    statuses: ["all", "active", "matured", "cancelled"],
    sorts: ["recent", "oldest", "amount"],
    defaultStatus: "all",
    defaultSort: "recent",
  },
  commissions: {
    statuses: ["all", "pending", "credited", "reversed"],
    sorts: ["recent", "oldest", "amount"],
    defaultStatus: "all",
    defaultSort: "recent",
  },
  referralAccounts: {
    statuses: ["all", "vip1", "vip2", "vip3"],
    sorts: ["earnings", "referrals", "recent"],
    defaultStatus: "all",
    defaultSort: "earnings",
  },
} as const;
