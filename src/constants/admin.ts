import {
  BadgeCheck,
  Banknote,
  BellRing,
  ClipboardList,
  LayoutDashboard,
  Layers,
  ScrollText,
  Settings,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type {
  AdminPermissionDescriptor,
  AdminPermissionId,
  AdminPermissionSet,
} from "@/types/admin";

/**
 * Master CRM configuration.
 *
 * Kept separate from `@/constants/app` (the user application) so the two areas
 * never share navigation or configuration by accident.
 */

export const ADMIN_APP_NAME = "Nanotron";
export const ADMIN_APP_SUBTITLE = "Master CRM";

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Permission that gates this destination. */
  permission: AdminPermissionId;
  /** Grouping in the sidebar. */
  group: "Overview" | "Operations" | "Platform" | "Administration";
}

/**
 * Single source of truth for the admin sidebar and the mobile nav drawer.
 * Adding an entry here adds it to both, and it is automatically hidden from
 * agents who lack the permission.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  {
    href: "/admin",
    label: "Dashboard",
    icon: LayoutDashboard,
    permission: "users",
    group: "Overview",
  },
  {
    href: "/admin/users",
    label: "Users",
    icon: Users,
    permission: "users",
    group: "Operations",
  },
  {
    href: "/admin/kyc",
    label: "KYC",
    icon: BadgeCheck,
    permission: "kyc",
    group: "Operations",
  },
  {
    href: "/admin/deposits",
    label: "Deposits",
    icon: Wallet,
    permission: "deposits",
    group: "Operations",
  },
  {
    href: "/admin/withdrawals",
    label: "Withdrawals",
    icon: Banknote,
    permission: "withdrawals",
    group: "Operations",
  },
  {
    href: "/admin/investments",
    label: "Investments",
    icon: TrendingUp,
    permission: "investments",
    group: "Operations",
  },
  {
    href: "/admin/plans",
    label: "Plans",
    icon: Layers,
    permission: "plans",
    group: "Platform",
  },
  {
    href: "/admin/referrals",
    label: "Referrals",
    icon: ClipboardList,
    permission: "referrals",
    group: "Platform",
  },
  {
    href: "/admin/notifications",
    label: "Notifications",
    icon: BellRing,
    permission: "notifications",
    group: "Platform",
  },
  {
    href: "/admin/agents",
    label: "Agents",
    icon: UserCog,
    permission: "agents",
    group: "Administration",
  },
  {
    href: "/admin/audit-logs",
    label: "Audit logs",
    icon: ScrollText,
    permission: "audit_logs",
    group: "Administration",
  },
  {
    href: "/admin/settings",
    label: "Settings",
    icon: Settings,
    permission: "settings",
    group: "Administration",
  },
];

export const ADMIN_NAV_GROUPS = [
  "Overview",
  "Operations",
  "Platform",
  "Administration",
] as const;

/** True when `pathname` should highlight `item` in the admin navigation. */
export function isAdminNavItemActive(item: AdminNavItem, pathname: string) {
  if (item.href === "/admin") return pathname === "/admin";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

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
    manageHint: "Revoke sessions and force sign-out across devices.",
  },
  {
    id: "agents",
    label: "Agent management",
    description: "View the agent directory and their activity.",
    manageHint: "Create agents, assign permissions and reset their passwords.",
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
 * hand-pick 13 toggles from scratch.
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
