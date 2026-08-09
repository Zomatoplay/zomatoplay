import {
  Home,
  Layers,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that should keep this item in its active state. */
  matches?: string[];
}

/**
 * The five primary sections. This array is the single source of truth for both
 * the mobile bottom navigation and the desktop sidebar — adding a section here
 * adds it to both.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/plans", label: "Plans", icon: Layers },
  {
    href: "/wallet",
    label: "Wallet",
    icon: Wallet,
    matches: ["/wallet/deposit", "/wallet/withdraw"],
  },
  { href: "/referral", label: "Referral", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** True when `pathname` should highlight `item` in the navigation. */
export function isNavItemActive(item: NavItem, pathname: string) {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
