import {
  BadgeCheck,
  Banknote,
  BellRing,
  ClipboardList,
  LayoutDashboard,
  Layers,
  ScrollText,
  Settings,
  Activity,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { AdminPermissionId } from "@/types/admin";

/**
 * Master CRM navigation.
 *
 * Split out of `@/constants/admin` because it is the only part of that module
 * that pulls in an icon library. The seed data imports the permission
 * catalogue, the server layer imports the seed data, and a repository has no
 * business dragging `lucide-react` into the server bundle to find out what a
 * permission is called. Everything with a `LucideIcon` in it lives here;
 * everything the domain needs lives there.
 */

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
    // Gated on `audit_logs` rather than a new permission: both answer "what
    // happened", both expose other people's activity, and adding a fourteenth
    // permission id means adding it to the enum, the constant, the matrix and
    // every seeded agent. The two screens are for different questions but the
    // same trust level.
    href: "/admin/system-logs",
    label: "System logs",
    icon: Activity,
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
