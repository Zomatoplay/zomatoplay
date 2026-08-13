import { ADMIN_PERMISSIONS } from "@/constants/admin";
import type {
  AdminPermissionId,
  AdminPermissionLevel,
  AdminPermissionSet,
  AdminSession,
} from "@/types/admin";

/**
 * Authorization helpers for the Master CRM.
 *
 * There is no real authentication yet. These functions read the demo session
 * held in the admin store, but their signatures are the ones a real
 * implementation keeps: swap the session source and every call site is
 * unchanged.
 *
 * INTEGRATION POINT: the same permission ids must be enforced server-side.
 * Client-side gating is a usability affordance, never a security boundary.
 */

const LEVEL_RANK: Record<AdminPermissionLevel, number> = {
  none: 0,
  view: 1,
  manage: 2,
};

/**
 * The level a session actually holds for a permission. A master admin
 * implicitly holds `manage` on everything — the role is the grant.
 */
export function permissionLevel(
  session: AdminSession,
  permission: AdminPermissionId,
): AdminPermissionLevel {
  if (session.role === "master_admin") return "manage";
  return session.permissions[permission] ?? "none";
}

/** True when the session can at least see the area. */
export function canView(
  session: AdminSession,
  permission: AdminPermissionId,
): boolean {
  return LEVEL_RANK[permissionLevel(session, permission)] >= LEVEL_RANK.view;
}

/** True when the session can perform mutating actions in the area. */
export function canManage(
  session: AdminSession,
  permission: AdminPermissionId,
): boolean {
  return permissionLevel(session, permission) === "manage";
}

export const PERMISSION_LEVEL_LABELS: Record<AdminPermissionLevel, string> = {
  none: "No access",
  view: "View only",
  manage: "Full access",
};

/** Short label for a level, for dense contexts such as the matrix legend. */
export const PERMISSION_LEVEL_SHORT: Record<AdminPermissionLevel, string> = {
  none: "None",
  view: "View",
  manage: "Manage",
};

export function permissionLabel(id: AdminPermissionId): string {
  return ADMIN_PERMISSIONS.find((p) => p.id === id)?.label ?? id;
}

/**
 * How many permissions an agent holds at each level — used for the summary
 * shown on agent rows, so the table does not need 13 columns.
 */
export function summarisePermissions(permissions: AdminPermissionSet) {
  const counts = { none: 0, view: 0, manage: 0 };
  for (const descriptor of ADMIN_PERMISSIONS) {
    counts[permissions[descriptor.id] ?? "none"] += 1;
  }
  return counts;
}
