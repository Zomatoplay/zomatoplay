"use client";

import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";

import { ADMIN_NOW } from "@/constants/admin";
import {
  DEFAULT_ADMIN_AGENT_ID,
  adminAgents,
  getAdminAgentById,
  toAdminSession,
} from "@/data/admin/agents";
import { auditLogEntries } from "@/data/admin/audit-logs";
import { adminDeposits } from "@/data/admin/deposits";
import { kycSubmissions } from "@/data/admin/kyc";
import { audienceReach, notificationCampaigns } from "@/data/admin/notifications";
import { adminPlans } from "@/data/admin/plans";
import { userDeviceSessions } from "@/data/admin/security";
import { platformSettings } from "@/data/admin/settings";
import { adminUsers } from "@/data/admin/users";
import { adminWithdrawals } from "@/data/admin/withdrawals";
import type {
  AdminAgent,
  AdminDeposit,
  AdminNotificationCampaign,
  AdminPermissionSet,
  AdminPlan,
  AdminSession,
  AdminUser,
  AdminUserRestrictions,
  AdminUserStatus,
  AdminWithdrawal,
  AuditAction,
  AuditLogEntry,
  KycSubmission,
  PlatformSettings,
  UserDeviceSession,
} from "@/types/admin";

/**
 * In-memory Master CRM state.
 *
 * WHY THIS EXISTS
 * ---------------
 * Same reasoning as the user application's `prototype-store`: the brief is
 * frontend-only, but an operations console is unreviewable if its actions do
 * nothing. This store holds the slice of platform state a real backend would
 * own, seeded from `@/data/admin`.
 *
 * It is a *separate* store from `@/lib/prototype-store` on purpose. The two
 * applications are architecturally isolated, they model the platform from
 * opposite sides, and in production they would talk to different APIs under
 * different credentials. Approving a KYC submission here does not change the
 * user app's session state, and it should not.
 *
 * SCOPE
 * -----
 * - Deliberately in-memory: state resets on a full reload. No persistence is
 *   introduced that would have to be unwound at integration time.
 * - No authentication. `session` is chosen from a demo control in the header so
 *   the permission model can actually be exercised.
 *
 * THE AUDIT LOG
 * -------------
 * Every mutating action funnels through `withAudit`, which prepends an entry to
 * `auditLog`. That is not decoration: it means the audit screen shows real
 * consequences of what the operator just did, and it mirrors how a real backend
 * should work — the write and its audit record are one transaction, never two
 * call sites that can drift apart.
 *
 * INTEGRATION POINT
 * -----------------
 * Each action below maps 1:1 to a future admin API call. Replace the reducer
 * cases with mutations plus `router.refresh()`; consumers keep working
 * unchanged. Client-side permission checks are a usability affordance only —
 * the same permission ids must be enforced server-side.
 */

interface State {
  session: AdminSession;
  users: AdminUser[];
  kyc: KycSubmission[];
  deposits: AdminDeposit[];
  withdrawals: AdminWithdrawal[];
  plans: AdminPlan[];
  agents: AdminAgent[];
  sessions: UserDeviceSession[];
  campaigns: AdminNotificationCampaign[];
  auditLog: AuditLogEntry[];
  settings: PlatformSettings;
}

const seedAgent = getAdminAgentById(DEFAULT_ADMIN_AGENT_ID) ?? adminAgents[0];

const initialState: State = {
  session: toAdminSession(seedAgent),
  users: adminUsers,
  kyc: kycSubmissions,
  deposits: adminDeposits,
  withdrawals: adminWithdrawals,
  plans: adminPlans,
  agents: adminAgents,
  sessions: userDeviceSessions,
  campaigns: notificationCampaigns,
  auditLog: auditLogEntries,
  settings: platformSettings,
};

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

export interface PlanDraft {
  name: string;
  tagline: string;
  description: string;
  minInvestment: number;
  maxInvestment: number;
  durationDays: number;
  estimatedReturnPercent: number;
  estimatedReturnRange: [number, number];
  rewardFrequency: AdminPlan["rewardFrequency"];
  risk: AdminPlan["risk"];
  status: AdminPlan["status"];
}

export interface AgentDraft {
  name: string;
  email: string;
  permissions: AdminPermissionSet;
  note?: string;
}

export interface CampaignDraft {
  title: string;
  body: string;
  audience: AdminNotificationCampaign["audience"];
  targetUserLabel: string | null;
  channels: AdminNotificationCampaign["channels"];
  templateId: AdminNotificationCampaign["templateId"];
}

type Action =
  | { type: "session/switch"; payload: { agentId: string } }
  /* KYC */
  | { type: "kyc/approve"; payload: { id: string; note?: string } }
  | { type: "kyc/reject"; payload: { id: string; reason: string } }
  | { type: "kyc/requestResubmission"; payload: { id: string; reason: string } }
  | { type: "kyc/addNote"; payload: { id: string; body: string } }
  /* Users */
  | { type: "user/setStatus"; payload: { id: string; status: AdminUserStatus; note?: string } }
  | {
      type: "user/setRestriction";
      payload: {
        id: string;
        key: keyof AdminUserRestrictions;
        value: boolean;
        note?: string;
      };
    }
  | {
      type: "user/update";
      payload: { id: string; changes: Partial<Pick<AdminUser, "fullName" | "email" | "phone" | "country" | "internalNote">> };
    }
  | { type: "user/resetPassword"; payload: { id: string; note?: string } }
  | { type: "user/resetTwoFactor"; payload: { id: string; note?: string } }
  /* Sessions */
  | { type: "session/revoke"; payload: { sessionId: string; userId: string; note?: string } }
  | { type: "session/revokeAll"; payload: { userId: string; note?: string } }
  /* Money */
  | { type: "deposit/credit"; payload: { id: string; note?: string } }
  | { type: "deposit/fail"; payload: { id: string; reason: string } }
  | { type: "withdrawal/approve"; payload: { id: string; note?: string } }
  | { type: "withdrawal/reject"; payload: { id: string; reason: string } }
  | { type: "withdrawal/markPaid"; payload: { id: string; reference?: string } }
  /* Plans */
  | { type: "plan/create"; payload: { draft: PlanDraft } }
  | { type: "plan/update"; payload: { id: string; draft: PlanDraft } }
  | { type: "plan/setDisabled"; payload: { id: string; disabled: boolean; note?: string } }
  /* Agents */
  | { type: "agent/create"; payload: { draft: AgentDraft } }
  | { type: "agent/update"; payload: { id: string; draft: AgentDraft } }
  | { type: "agent/setDisabled"; payload: { id: string; disabled: boolean; note?: string } }
  | { type: "agent/resetPassword"; payload: { id: string; note?: string } }
  | {
      type: "agent/setPermissions";
      payload: { id: string; permissions: AdminPermissionSet };
    }
  /* Platform */
  | { type: "notification/send"; payload: { draft: CampaignDraft } }
  | { type: "settings/update"; payload: { settings: PlatformSettings; summary: string } }
  | { type: "reset" };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Monotonic ids for records created during a session. */
let sequence = 0;
function nextId(prefix: string) {
  sequence += 1;
  return `${prefix}_local_${sequence}`;
}

/**
 * `new Date()` during render causes hydration mismatches, so records created in
 * a session are stamped from a fixed clock that only advances when an action is
 * dispatched — always inside an event handler, never during render.
 */
function stamp() {
  sequence += 1;
  return new Date(Date.parse(ADMIN_NOW) + sequence * 1000).toISOString();
}

function audit(
  state: State,
  action: AuditAction,
  target: AuditLogEntry["target"],
  details: string,
  outcome: AuditLogEntry["outcome"] = "success",
): AuditLogEntry {
  return {
    id: nextId("AUD"),
    actorId: state.session.agentId,
    actorName: state.session.name,
    actorRole: state.session.role,
    action,
    target,
    createdAt: stamp(),
    // A real backend records the request's source address.
    ipAddress: "10.24.7.1",
    outcome,
    details,
  };
}

/** Apply a state change and its audit entry together, so they cannot drift. */
function withAudit(
  state: State,
  changes: Partial<State>,
  entry: AuditLogEntry,
): State {
  return { ...state, ...changes, auditLog: [entry, ...state.auditLog] };
}

/**
 * Appends the operator's stated reason to an audit detail line.
 *
 * Every confirmation dialog tells the operator "This is recorded in the audit
 * log", and several of them *require* a reason before they will proceed. That
 * promise only holds if the reason actually reaches the entry — so it is joined
 * here rather than left to each call site to remember.
 */
function withNote(details: string, note?: string) {
  const trimmed = note?.trim();
  return trimmed ? `${details} Reason: ${trimmed}` : details;
}

function userTarget(user: AdminUser): AuditLogEntry["target"] {
  return {
    type: "user",
    id: user.id,
    label: `${user.fullName} · ${user.displayId}`,
  };
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const USER_STATUS_ACTIONS: Record<AdminUserStatus, AuditAction> = {
  active: "user_unblocked",
  blocked: "user_blocked",
  suspended: "user_suspended",
  deactivated: "user_deactivated",
  inactive: "user_updated",
};

const RESTRICTION_LABELS: Record<keyof AdminUserRestrictions, string> = {
  accountFrozen: "Account freeze",
  withdrawalsFrozen: "Withdrawal freeze",
  investmentsFrozen: "Investment freeze",
};

/* -------------------------------------------------------------------------- */
/* Reducer                                                                     */
/* -------------------------------------------------------------------------- */

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "session/switch": {
      const agent = state.agents.find((a) => a.id === action.payload.agentId);
      if (!agent) return state;
      return { ...state, session: toAdminSession(agent) };
    }

    /* ---------------------------------------------------------------- KYC */

    case "kyc/approve": {
      const submission = state.kyc.find((s) => s.id === action.payload.id);
      if (!submission) return state;
      const reviewedAt = stamp();
      return withAudit(
        state,
        {
          kyc: state.kyc.map((s) =>
            s.id === submission.id
              ? {
                  ...s,
                  status: "approved",
                  reviewedBy: state.session.name,
                  reviewedAt,
                  rejectionReason: null,
                }
              : s,
          ),
          users: state.users.map((u) =>
            u.id === submission.userId ? { ...u, kycStatus: "verified" } : u,
          ),
        },
        audit(
          state,
          "kyc_approved",
          {
            type: "user",
            id: submission.userId,
            label: `${submission.userName} · ${submission.userDisplayId}`,
          },
          withNote(
            "Verification approved. The user can now invest and withdraw.",
            action.payload.note,
          ),
        ),
      );
    }

    case "kyc/reject": {
      const submission = state.kyc.find((s) => s.id === action.payload.id);
      if (!submission) return state;
      const reviewedAt = stamp();
      return withAudit(
        state,
        {
          kyc: state.kyc.map((s) =>
            s.id === submission.id
              ? {
                  ...s,
                  status: "rejected",
                  reviewedBy: state.session.name,
                  reviewedAt,
                  rejectionReason: action.payload.reason,
                }
              : s,
          ),
          users: state.users.map((u) =>
            u.id === submission.userId ? { ...u, kycStatus: "rejected" } : u,
          ),
        },
        audit(
          state,
          "kyc_rejected",
          {
            type: "user",
            id: submission.userId,
            label: `${submission.userName} · ${submission.userDisplayId}`,
          },
          `Verification rejected — ${action.payload.reason}`,
        ),
      );
    }

    case "kyc/requestResubmission": {
      const submission = state.kyc.find((s) => s.id === action.payload.id);
      if (!submission) return state;
      const reviewedAt = stamp();
      return withAudit(
        state,
        {
          kyc: state.kyc.map((s) =>
            s.id === submission.id
              ? {
                  ...s,
                  status: "resubmission_requested",
                  reviewedBy: state.session.name,
                  reviewedAt,
                }
              : s,
          ),
          users: state.users.map((u) =>
            u.id === submission.userId ? { ...u, kycStatus: "in_progress" } : u,
          ),
        },
        audit(
          state,
          "kyc_resubmission_requested",
          {
            type: "user",
            id: submission.userId,
            label: `${submission.userName} · ${submission.userDisplayId}`,
          },
          `Resubmission requested — ${action.payload.reason}`,
        ),
      );
    }

    case "kyc/addNote": {
      const submission = state.kyc.find((s) => s.id === action.payload.id);
      if (!submission) return state;
      return withAudit(
        state,
        {
          kyc: state.kyc.map((s) =>
            s.id === submission.id
              ? {
                  ...s,
                  notes: [
                    ...s.notes,
                    {
                      id: nextId("note"),
                      author: state.session.name,
                      body: action.payload.body,
                      createdAt: stamp(),
                    },
                  ],
                }
              : s,
          ),
        },
        audit(
          state,
          "kyc_note_added",
          {
            type: "kyc",
            id: submission.id,
            label: `${submission.userName} · ${submission.id}`,
          },
          "Internal note added to the verification case.",
        ),
      );
    }

    /* -------------------------------------------------------------- Users */

    case "user/setStatus": {
      const user = state.users.find((u) => u.id === action.payload.id);
      if (!user) return state;
      const { status } = action.payload;
      return withAudit(
        state,
        {
          users: state.users.map((u) =>
            u.id === user.id
              ? {
                  ...u,
                  status,
                  restrictions:
                    status === "blocked"
                      ? { ...u.restrictions, accountFrozen: true }
                      : status === "active"
                        ? { ...u.restrictions, accountFrozen: false }
                        : u.restrictions,
                }
              : u,
          ),
        },
        audit(
          state,
          USER_STATUS_ACTIONS[status],
          userTarget(user),
          withNote(
            `Account status changed from ${user.status} to ${status}.`,
            action.payload.note,
          ),
        ),
      );
    }

    case "user/setRestriction": {
      const user = state.users.find((u) => u.id === action.payload.id);
      if (!user) return state;
      const { key, value } = action.payload;
      return withAudit(
        state,
        {
          users: state.users.map((u) =>
            u.id === user.id
              ? { ...u, restrictions: { ...u.restrictions, [key]: value } }
              : u,
          ),
        },
        audit(
          state,
          "user_restriction_changed",
          userTarget(user),
          withNote(
            `${RESTRICTION_LABELS[key]} ${value ? "applied" : "lifted"}.`,
            action.payload.note,
          ),
        ),
      );
    }

    case "user/update": {
      const user = state.users.find((u) => u.id === action.payload.id);
      if (!user) return state;
      const changed = Object.keys(action.payload.changes);
      return withAudit(
        state,
        {
          users: state.users.map((u) =>
            u.id === user.id ? { ...u, ...action.payload.changes } : u,
          ),
        },
        audit(
          state,
          "user_updated",
          userTarget(user),
          `Profile updated (${changed.join(", ")}).`,
        ),
      );
    }

    case "user/resetPassword": {
      const user = state.users.find((u) => u.id === action.payload.id);
      if (!user) return state;
      return withAudit(
        state,
        {},
        audit(
          state,
          "user_password_reset",
          userTarget(user),
          withNote(
            "Password reset link sent to the user's registered email address.",
            action.payload.note,
          ),
        ),
      );
    }

    case "user/resetTwoFactor": {
      const user = state.users.find((u) => u.id === action.payload.id);
      if (!user) return state;
      return withAudit(
        state,
        {
          users: state.users.map((u) =>
            u.id === user.id ? { ...u, twoFactorEnabled: false } : u,
          ),
        },
        audit(
          state,
          "user_two_factor_reset",
          userTarget(user),
          withNote(
            "Two-factor authentication reset. The user must enrol a new device.",
            action.payload.note,
          ),
        ),
      );
    }

    /* ----------------------------------------------------------- Sessions */

    case "session/revoke": {
      const user = state.users.find((u) => u.id === action.payload.userId);
      const target = state.sessions.find((s) => s.id === action.payload.sessionId);
      if (!user || !target) return state;
      return withAudit(
        state,
        {
          sessions: state.sessions.map((s) =>
            s.id === target.id ? { ...s, status: "revoked", current: false } : s,
          ),
        },
        audit(
          state,
          "device_logged_out",
          userTarget(user),
          withNote(
            `Session revoked — ${target.device} · ${target.browser} (${target.location}).`,
            action.payload.note,
          ),
        ),
      );
    }

    case "session/revokeAll": {
      const user = state.users.find((u) => u.id === action.payload.userId);
      if (!user) return state;
      const affected = state.sessions.filter(
        (s) => s.userId === user.id && s.status === "active",
      ).length;
      return withAudit(
        state,
        {
          sessions: state.sessions.map((s) =>
            s.userId === user.id && s.status === "active"
              ? { ...s, status: "revoked", current: false }
              : s,
          ),
        },
        audit(
          state,
          "all_devices_logged_out",
          userTarget(user),
          withNote(
            `All sessions revoked (${affected} active ${affected === 1 ? "device" : "devices"}). The user must sign in again.`,
            action.payload.note,
          ),
        ),
      );
    }

    /* -------------------------------------------------------------- Money */

    case "deposit/credit": {
      const target = state.deposits.find((d) => d.id === action.payload.id);
      if (!target) return state;
      const creditedAt = stamp();
      return withAudit(
        state,
        {
          deposits: state.deposits.map((d) =>
            d.id === target.id
              ? {
                  ...d,
                  status: "credited",
                  creditedAt,
                  confirmations: {
                    ...d.confirmations,
                    current: d.confirmations.required,
                  },
                }
              : d,
          ),
          users: state.users.map((u) =>
            u.id === target.userId
              ? {
                  ...u,
                  totals: {
                    ...u.totals,
                    availableUsdt: u.totals.availableUsdt + target.amountUsdt,
                    totalDeposited: u.totals.totalDeposited + target.amountUsdt,
                  },
                }
              : u,
          ),
        },
        audit(
          state,
          "deposit_credited",
          {
            type: "deposit",
            id: target.id,
            label: `${target.id} · ${target.amountUsdt} USDT`,
          },
          withNote(
            `Credited to ${target.userName} (${target.userDisplayId}).`,
            action.payload.note,
          ),
        ),
      );
    }

    case "deposit/fail": {
      const target = state.deposits.find((d) => d.id === action.payload.id);
      if (!target) return state;
      return withAudit(
        state,
        {
          deposits: state.deposits.map((d) =>
            d.id === target.id
              ? { ...d, status: "failed", failureReason: action.payload.reason }
              : d,
          ),
        },
        audit(
          state,
          "deposit_failed",
          {
            type: "deposit",
            id: target.id,
            label: `${target.id} · ${target.amountUsdt} USDT`,
          },
          `Marked failed — ${action.payload.reason}`,
        ),
      );
    }

    case "withdrawal/approve": {
      const target = state.withdrawals.find((w) => w.id === action.payload.id);
      if (!target) return state;
      return withAudit(
        state,
        {
          withdrawals: state.withdrawals.map((w) =>
            w.id === target.id
              ? { ...w, status: "approved", reviewedBy: state.session.name }
              : w,
          ),
        },
        audit(
          state,
          "withdrawal_approved",
          {
            type: "withdrawal",
            id: target.id,
            label: `${target.id} · ${target.amountUsdt} USDT`,
          },
          withNote(
            `Approved for payout to ${target.destination.bankName} ${target.destination.accountNumberMasked}.`,
            action.payload.note,
          ),
        ),
      );
    }

    case "withdrawal/reject": {
      const target = state.withdrawals.find((w) => w.id === action.payload.id);
      if (!target) return state;
      return withAudit(
        state,
        {
          withdrawals: state.withdrawals.map((w) =>
            w.id === target.id
              ? {
                  ...w,
                  status: "rejected",
                  reviewedBy: state.session.name,
                  rejectionReason: action.payload.reason,
                }
              : w,
          ),
        },
        audit(
          state,
          "withdrawal_rejected",
          {
            type: "withdrawal",
            id: target.id,
            label: `${target.id} · ${target.amountUsdt} USDT`,
          },
          `Rejected — ${action.payload.reason}`,
        ),
      );
    }

    case "withdrawal/markPaid": {
      const target = state.withdrawals.find((w) => w.id === action.payload.id);
      if (!target) return state;
      const settledAt = stamp();
      return withAudit(
        state,
        {
          withdrawals: state.withdrawals.map((w) =>
            w.id === target.id
              ? {
                  ...w,
                  status: "paid",
                  settledAt,
                  reviewedBy: w.reviewedBy ?? state.session.name,
                  payoutReference:
                    action.payload.reference?.trim() ||
                    w.payoutReference ||
                    `IMPS-${Date.parse(settledAt)}`,
                }
              : w,
          ),
          users: state.users.map((u) =>
            u.id === target.userId
              ? {
                  ...u,
                  totals: {
                    ...u.totals,
                    totalWithdrawn: u.totals.totalWithdrawn + target.amountUsdt,
                  },
                }
              : u,
          ),
        },
        audit(
          state,
          "withdrawal_marked_paid",
          {
            type: "withdrawal",
            id: target.id,
            label: `${target.id} · ${target.amountUsdt} USDT`,
          },
          withNote(
            `Payout confirmed to ${target.userName} (${target.userDisplayId}).`,
            action.payload.reference
              ? `payout reference ${action.payload.reference.trim()}`
              : undefined,
          ),
        ),
      );
    }

    /* -------------------------------------------------------------- Plans */

    case "plan/create": {
      const { draft } = action.payload;
      const plan: AdminPlan = {
        id: nextId("plan"),
        slug: slugify(draft.name) || nextId("plan"),
        name: draft.name,
        tagline: draft.tagline,
        description: draft.description,
        minInvestment: draft.minInvestment,
        maxInvestment: draft.maxInvestment,
        durationDays: draft.durationDays,
        estimatedReturnPercent: draft.estimatedReturnPercent,
        estimatedReturnRange: draft.estimatedReturnRange,
        rewardFrequency: draft.rewardFrequency,
        risk: draft.risk,
        status: draft.status,
        stats: { activeInvestments: 0, totalAllocated: 0, totalProfitPaid: 0 },
        updatedAt: stamp(),
      };
      return withAudit(
        state,
        { plans: [plan, ...state.plans] },
        audit(
          state,
          "plan_created",
          { type: "plan", id: plan.id, label: plan.name },
          `Created with a ${draft.durationDays === 0 ? "no lock-in" : `${draft.durationDays}-day`} term and a ${draft.minInvestment} USDT minimum.`,
        ),
      );
    }

    case "plan/update": {
      const plan = state.plans.find((p) => p.id === action.payload.id);
      if (!plan) return state;
      const { draft } = action.payload;
      return withAudit(
        state,
        {
          plans: state.plans.map((p) =>
            p.id === plan.id ? { ...p, ...draft, updatedAt: stamp() } : p,
          ),
        },
        audit(
          state,
          "plan_updated",
          { type: "plan", id: plan.id, label: draft.name },
          "Plan parameters updated.",
        ),
      );
    }

    case "plan/setDisabled": {
      const plan = state.plans.find((p) => p.id === action.payload.id);
      if (!plan) return state;
      const { disabled } = action.payload;
      return withAudit(
        state,
        {
          plans: state.plans.map((p) =>
            p.id === plan.id
              ? { ...p, status: disabled ? "disabled" : "open", updatedAt: stamp() }
              : p,
          ),
        },
        audit(
          state,
          disabled ? "plan_disabled" : "plan_enabled",
          { type: "plan", id: plan.id, label: plan.name },
          withNote(
            disabled
              ? "Withdrawn from the app. Existing allocations continue to run."
              : "Re-opened to new allocations.",
            action.payload.note,
          ),
        ),
      );
    }

    /* ------------------------------------------------------------- Agents */

    case "agent/create": {
      const { draft } = action.payload;
      const agent: AdminAgent = {
        id: nextId("agt"),
        name: draft.name,
        email: draft.email,
        role: "agent",
        status: "invited",
        createdAt: stamp(),
        lastActiveAt: null,
        permissions: draft.permissions,
        note: draft.note,
        passwordResetRequestedAt: stamp(),
      };
      return withAudit(
        state,
        { agents: [...state.agents, agent] },
        audit(
          state,
          "agent_created",
          { type: "agent", id: agent.id, label: agent.name },
          `Created agent ${agent.email}. Invitation sent.`,
        ),
      );
    }

    case "agent/update": {
      const agent = state.agents.find((a) => a.id === action.payload.id);
      if (!agent) return state;
      const { draft } = action.payload;
      return withAudit(
        state,
        {
          agents: state.agents.map((a) =>
            a.id === agent.id
              ? {
                  ...a,
                  name: draft.name,
                  email: draft.email,
                  permissions: draft.permissions,
                  note: draft.note,
                }
              : a,
          ),
        },
        audit(
          state,
          "agent_updated",
          { type: "agent", id: agent.id, label: draft.name },
          "Agent details updated.",
        ),
      );
    }

    case "agent/setDisabled": {
      const agent = state.agents.find((a) => a.id === action.payload.id);
      if (!agent || agent.role === "master_admin") return state;
      const { disabled } = action.payload;
      return withAudit(
        state,
        {
          agents: state.agents.map((a) =>
            a.id === agent.id ? { ...a, status: disabled ? "disabled" : "active" } : a,
          ),
        },
        audit(
          state,
          disabled ? "agent_disabled" : "agent_enabled",
          { type: "agent", id: agent.id, label: agent.name },
          withNote(
            disabled
              ? "Access revoked. Historical actions are retained in this log."
              : "Access restored.",
            action.payload.note,
          ),
        ),
      );
    }

    case "agent/resetPassword": {
      const agent = state.agents.find((a) => a.id === action.payload.id);
      if (!agent) return state;
      const requestedAt = stamp();
      return withAudit(
        state,
        {
          agents: state.agents.map((a) =>
            a.id === agent.id ? { ...a, passwordResetRequestedAt: requestedAt } : a,
          ),
        },
        audit(
          state,
          "agent_password_reset",
          { type: "agent", id: agent.id, label: agent.name },
          withNote(`Password reset link sent to ${agent.email}.`, action.payload.note),
        ),
      );
    }

    case "agent/setPermissions": {
      const agent = state.agents.find((a) => a.id === action.payload.id);
      if (!agent || agent.role === "master_admin") return state;
      const { permissions } = action.payload;
      const changed = Object.keys(permissions).filter(
        (key) =>
          permissions[key as keyof AdminPermissionSet] !==
          agent.permissions[key as keyof AdminPermissionSet],
      );
      return withAudit(
        state,
        {
          agents: state.agents.map((a) =>
            a.id === agent.id ? { ...a, permissions } : a,
          ),
        },
        audit(
          state,
          "agent_permissions_changed",
          { type: "agent", id: agent.id, label: agent.name },
          changed.length > 0
            ? `Changed ${changed.length} ${changed.length === 1 ? "permission" : "permissions"}: ${changed.join(", ")}.`
            : "Permissions saved with no changes.",
        ),
      );
    }

    /* ----------------------------------------------------------- Platform */

    case "notification/send": {
      const { draft } = action.payload;
      const campaign: AdminNotificationCampaign = {
        id: nextId("NTF"),
        title: draft.title,
        body: draft.body,
        audience: draft.audience,
        targetUserLabel: draft.targetUserLabel,
        channels: draft.channels,
        templateId: draft.templateId,
        sentAt: stamp(),
        sentBy: state.session.name,
        recipientCount:
          draft.audience === "single_user" ? 1 : audienceReach(draft.audience),
        status: "sent",
      };
      return withAudit(
        state,
        { campaigns: [campaign, ...state.campaigns] },
        audit(
          state,
          "notification_sent",
          { type: "notification", id: campaign.id, label: campaign.title },
          `Sent to ${campaign.recipientCount.toLocaleString("en-IN")} ${campaign.recipientCount === 1 ? "recipient" : "recipients"} via ${draft.channels.join(", ")}.`,
        ),
      );
    }

    case "settings/update":
      return withAudit(
        state,
        { settings: action.payload.settings },
        audit(
          state,
          "settings_updated",
          { type: "settings", id: "platform", label: "Platform settings" },
          action.payload.summary,
        ),
      );

    case "reset":
      return initialState;
  }
}

/* -------------------------------------------------------------------------- */
/* Context                                                                     */
/* -------------------------------------------------------------------------- */

interface StoreValue extends State {
  switchSession: (agentId: string) => void;
  approveKyc: (id: string, note?: string) => void;
  rejectKyc: (id: string, reason: string) => void;
  requestKycResubmission: (id: string, reason: string) => void;
  addKycNote: (id: string, body: string) => void;
  setUserStatus: (id: string, status: AdminUserStatus, note?: string) => void;
  setUserRestriction: (
    id: string,
    key: keyof AdminUserRestrictions,
    value: boolean,
    note?: string,
  ) => void;
  updateUser: (
    id: string,
    changes: Partial<
      Pick<AdminUser, "fullName" | "email" | "phone" | "country" | "internalNote">
    >,
  ) => void;
  resetUserPassword: (id: string, note?: string) => void;
  resetUserTwoFactor: (id: string, note?: string) => void;
  revokeSession: (sessionId: string, userId: string, note?: string) => void;
  revokeAllSessions: (userId: string, note?: string) => void;
  creditDeposit: (id: string, note?: string) => void;
  failDeposit: (id: string, reason: string) => void;
  approveWithdrawal: (id: string, note?: string) => void;
  rejectWithdrawal: (id: string, reason: string) => void;
  markWithdrawalPaid: (id: string, reference?: string) => void;
  createPlan: (draft: PlanDraft) => void;
  updatePlan: (id: string, draft: PlanDraft) => void;
  setPlanDisabled: (id: string, disabled: boolean, note?: string) => void;
  createAgent: (draft: AgentDraft) => void;
  updateAgent: (id: string, draft: AgentDraft) => void;
  setAgentDisabled: (id: string, disabled: boolean, note?: string) => void;
  resetAgentPassword: (id: string, note?: string) => void;
  setAgentPermissions: (id: string, permissions: AdminPermissionSet) => void;
  sendNotification: (draft: CampaignDraft) => void;
  updateSettings: (settings: PlatformSettings, summary: string) => void;
  reset: () => void;
}

const AdminStoreContext = createContext<StoreValue | null>(null);

export function AdminStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const value = useMemo<StoreValue>(
    () => ({
      ...state,
      switchSession: (agentId) =>
        dispatch({ type: "session/switch", payload: { agentId } }),
      approveKyc: (id, note) => dispatch({ type: "kyc/approve", payload: { id, note } }),
      rejectKyc: (id, reason) =>
        dispatch({ type: "kyc/reject", payload: { id, reason } }),
      requestKycResubmission: (id, reason) =>
        dispatch({ type: "kyc/requestResubmission", payload: { id, reason } }),
      addKycNote: (id, body) =>
        dispatch({ type: "kyc/addNote", payload: { id, body } }),
      setUserStatus: (id, status, note) =>
        dispatch({ type: "user/setStatus", payload: { id, status, note } }),
      setUserRestriction: (id, key, value, note) =>
        dispatch({ type: "user/setRestriction", payload: { id, key, value, note } }),
      updateUser: (id, changes) =>
        dispatch({ type: "user/update", payload: { id, changes } }),
      resetUserPassword: (id, note) =>
        dispatch({ type: "user/resetPassword", payload: { id, note } }),
      resetUserTwoFactor: (id, note) =>
        dispatch({ type: "user/resetTwoFactor", payload: { id, note } }),
      revokeSession: (sessionId, userId, note) =>
        dispatch({ type: "session/revoke", payload: { sessionId, userId, note } }),
      revokeAllSessions: (userId, note) =>
        dispatch({ type: "session/revokeAll", payload: { userId, note } }),
      creditDeposit: (id, note) =>
        dispatch({ type: "deposit/credit", payload: { id, note } }),
      failDeposit: (id, reason) =>
        dispatch({ type: "deposit/fail", payload: { id, reason } }),
      approveWithdrawal: (id, note) =>
        dispatch({ type: "withdrawal/approve", payload: { id, note } }),
      rejectWithdrawal: (id, reason) =>
        dispatch({ type: "withdrawal/reject", payload: { id, reason } }),
      markWithdrawalPaid: (id, reference) =>
        dispatch({ type: "withdrawal/markPaid", payload: { id, reference } }),
      createPlan: (draft) => dispatch({ type: "plan/create", payload: { draft } }),
      updatePlan: (id, draft) =>
        dispatch({ type: "plan/update", payload: { id, draft } }),
      setPlanDisabled: (id, disabled, note) =>
        dispatch({ type: "plan/setDisabled", payload: { id, disabled, note } }),
      createAgent: (draft) => dispatch({ type: "agent/create", payload: { draft } }),
      updateAgent: (id, draft) =>
        dispatch({ type: "agent/update", payload: { id, draft } }),
      setAgentDisabled: (id, disabled, note) =>
        dispatch({ type: "agent/setDisabled", payload: { id, disabled, note } }),
      resetAgentPassword: (id, note) =>
        dispatch({ type: "agent/resetPassword", payload: { id, note } }),
      setAgentPermissions: (id, permissions) =>
        dispatch({ type: "agent/setPermissions", payload: { id, permissions } }),
      sendNotification: (draft) =>
        dispatch({ type: "notification/send", payload: { draft } }),
      updateSettings: (settings, summary) =>
        dispatch({ type: "settings/update", payload: { settings, summary } }),
      reset: () => dispatch({ type: "reset" }),
    }),
    [state],
  );

  return (
    <AdminStoreContext.Provider value={value}>
      {children}
    </AdminStoreContext.Provider>
  );
}

export function useAdminStore() {
  const context = useContext(AdminStoreContext);
  if (!context) {
    throw new Error("useAdminStore must be used inside <AdminStoreProvider>.");
  }
  return context;
}
