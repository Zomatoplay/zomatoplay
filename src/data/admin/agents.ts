import { AGENT_PRESETS, buildPermissionSet } from "@/constants/admin";
import type { AdminAgent, AdminSession } from "@/types/admin";

/**
 * Mock operator directory.
 *
 * There is no authentication. The "signed-in" operator is chosen from a demo
 * control in the admin header so the permission model can actually be
 * exercised — see `@/lib/admin-store`.
 *
 * INTEGRATION POINT: replace with the identity provider's user list. The
 * `permissions` map is the contract the backend authorization layer enforces.
 */

function preset(id: string) {
  const found = AGENT_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`Unknown agent preset: ${id}`);
  return found.permissions;
}

export const adminAgents: AdminAgent[] = [
  {
    id: "agt_master",
    name: "Neel Varma",
    email: "neel.varma@nanotron.app",
    role: "master_admin",
    status: "active",
    createdAt: "2025-09-01T08:00:00.000Z",
    lastActiveAt: "2026-08-09T08:55:00.000Z",
    // A master admin's grants are implied by the role; the map is kept
    // complete so the matrix renders consistently for every operator.
    permissions: buildPermissionSet("manage"),
    note: "Platform owner. Cannot be disabled or have permissions reduced.",
  },
  {
    id: "agt_compliance_1",
    name: "Divya Nambiar",
    email: "divya.nambiar@nanotron.app",
    role: "agent",
    status: "active",
    createdAt: "2025-10-14T09:30:00.000Z",
    lastActiveAt: "2026-08-09T08:12:00.000Z",
    permissions: preset("compliance"),
    note: "Leads KYC review. First reviewer on flagged submissions.",
  },
  {
    id: "agt_finance_1",
    name: "Rohit Malviya",
    email: "rohit.malviya@nanotron.app",
    role: "agent",
    status: "active",
    createdAt: "2025-11-02T11:15:00.000Z",
    lastActiveAt: "2026-08-09T07:44:00.000Z",
    permissions: {
      ...preset("finance"),
      // Also reviews KYC when the compliance queue backs up.
      kyc: "manage",
    },
    note: "Withdrawal approvals above 2,000 USDT and KYC overflow.",
  },
  {
    id: "agt_finance_2",
    name: "Priyanka Rane",
    email: "priyanka.rane@nanotron.app",
    role: "agent",
    status: "active",
    createdAt: "2026-01-20T10:05:00.000Z",
    lastActiveAt: "2026-08-08T18:30:00.000Z",
    permissions: preset("finance"),
    note: "Processes the daily payout batch.",
  },
  {
    id: "agt_support_1",
    name: "Kabir Sethi",
    email: "kabir.sethi@nanotron.app",
    role: "agent",
    status: "active",
    createdAt: "2026-02-11T14:40:00.000Z",
    lastActiveAt: "2026-08-09T06:20:00.000Z",
    permissions: preset("support"),
    note: "Front-line support. Read-only across the platform.",
  },
  {
    id: "agt_support_2",
    name: "Ayesha Khan",
    email: "ayesha.khan@nanotron.app",
    role: "agent",
    status: "active",
    createdAt: "2026-04-03T09:12:00.000Z",
    lastActiveAt: "2026-08-08T21:05:00.000Z",
    permissions: {
      ...preset("support"),
      security: "manage",
    },
    note: "Support lead. Can revoke sessions on compromised accounts.",
  },
  {
    id: "agt_ops_1",
    name: "Vivek Raghavan",
    email: "vivek.raghavan@nanotron.app",
    role: "agent",
    status: "active",
    createdAt: "2026-05-19T13:26:00.000Z",
    lastActiveAt: "2026-08-07T16:48:00.000Z",
    permissions: preset("operations"),
    note: "Owns the plan catalogue and platform announcements.",
  },
  {
    id: "agt_support_3",
    name: "Tara Joshi",
    email: "tara.joshi@nanotron.app",
    role: "agent",
    status: "invited",
    createdAt: "2026-08-08T10:00:00.000Z",
    lastActiveAt: null,
    permissions: preset("support"),
    note: "Invitation sent 08 Aug. Has not signed in yet.",
    passwordResetRequestedAt: "2026-08-08T10:00:00.000Z",
  },
  {
    id: "agt_finance_3",
    name: "Sameer Dutta",
    email: "sameer.dutta@nanotron.app",
    role: "agent",
    status: "disabled",
    createdAt: "2025-12-08T08:45:00.000Z",
    lastActiveAt: "2026-06-30T17:22:00.000Z",
    permissions: preset("finance"),
    note: "Disabled 30 Jun — left the team. Access retained for audit purposes.",
  },
];

/** The operator the CRM opens as. Master admin, so nothing is hidden at first. */
export const DEFAULT_ADMIN_AGENT_ID = "agt_master";

export function getAdminAgentById(id: string): AdminAgent | undefined {
  return adminAgents.find((a) => a.id === id);
}

/** Build the demo session for an agent. Stands in for a real session principal. */
export function toAdminSession(agent: AdminAgent): AdminSession {
  return {
    agentId: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    permissions: agent.permissions,
  };
}

export const agentStatusLabels: Record<AdminAgent["status"], string> = {
  active: "Active",
  disabled: "Disabled",
  invited: "Invited",
};
