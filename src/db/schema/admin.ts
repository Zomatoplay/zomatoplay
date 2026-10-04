import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { ts } from "./columns";
import {
  adminPermissionEnum,
  adminPermissionLevelEnum,
  adminRoleEnum,
  agentStatusEnum,
  auditActionEnum,
  auditOutcomeEnum,
  auditTargetTypeEnum,
} from "./enums";
import type { PlatformSettings, StoredPlatformSection } from "@/types/admin";

/**
 * Operators of the Master CRM.
 *
 * NO CREDENTIAL COLUMN EXISTS, AND NONE EVER SHOULD.
 *
 * Operators sign in with their mobile number and an SMS code (Firebase phone
 * auth); `firebase_uid` is the link, bound on the first verified sign-in to the
 * number a master admin provisioned in `phone_e164`. `auth_user_id` is the
 * older Supabase link, honoured only while `LEGACY_OPERATOR_EMAIL_SIGN_IN` is
 * on. There is no password, no hash, no one-time code and no token in
 * `public` — a second credential store is a second thing to leak, and an
 * operations console is the worst place to keep one.
 *
 * Nullable, because the seeded operators are fixtures with nobody behind them.
 * An operator row with no `auth_user_id` cannot sign in; it exists so the
 * permission matrix, the agent directory and historical audit entries have
 * something to point at. `npm run db:dev-admin` links one to a real credential
 * for local work.
 */
export const adminAgents = pgTable(
  "admin_agents",
  {
    id: text("id").primaryKey(),

    /**
     * The Supabase Auth principal this operator signs in as.
     *
     * The *only* path from a request to an operator identity. Before this
     * column existed the agent id arrived from the browser — the demo session
     * switcher in the header — so the permission model was real and the
     * identity behind it was not. Any caller could name themselves master
     * admin and approve a KYC case.
     *
     * Unique, so one credential cannot drive two operator accounts.
     */
    authUserId: uuid("auth_user_id"),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    role: adminRoleEnum("role").notNull().default("agent"),
    status: agentStatusEnum("status").notNull().default("invited"),
    createdAt: ts("created_at").notNull(),
    lastActiveAt: ts("last_active_at"),
    note: text("note"),
    passwordResetRequestedAt: ts("password_reset_requested_at"),

    /**
     * The mobile number this operator signs in with, E.164 (`+91…`).
     *
     * Set by a master admin (or `npm run db:operator-phone`), never by the
     * operator: it is an authorization — "this number may become this
     * operator" — which is why matching a verified number against it on the
     * first sign-in is safe here when it is not for a customer's self-typed
     * `users.phone`. Changing it unbinds `firebase_uid` and ends every session.
     */
    phoneE164: text("phone_e164"),
    /**
     * The Firebase uid that proved control of `phone_e164`, bound on the first
     * verified sign-in. Every later sign-in must present this uid.
     */
    firebaseUid: text("firebase_uid"),
    phoneVerifiedAt: ts("phone_verified_at"),
    /**
     * Operator sessions carry the value this had when issued; sign-out and a
     * phone change increment it, ending every session on every device.
     */
    sessionEpoch: integer("session_epoch").notNull().default(0),
    /**
     * This operator's own console access code, scrypt-hashed
     * (`@/server/auth/password-hash`), set by a master admin in Admin →
     * Agents. It is the second factor asked BEFORE the SMS is sent
     * (`access-gate`), not a sign-in credential on its own: Firebase still has
     * to prove the number. Null means no code has been set — the operator
     * can then pass the gate only through the deployment's environment
     * codes (the first master admin's bootstrap). Never selected into any
     * read model, never returned, never logged.
     */
    accessCodeHash: text("access_code_hash"),
  },
  (table) => [
    uniqueIndex("admin_agents_auth_user_id_key").on(table.authUserId),
    uniqueIndex("admin_agents_phone_e164_key").on(table.phoneE164),
    uniqueIndex("admin_agents_firebase_uid_key").on(table.firebaseUid),
    index("admin_agents_status_idx").on(table.status),
  ],
);

/**
 * Graded permissions, one row per (agent, area).
 *
 * Normalised rather than a jsonb blob because this list is the authorization
 * contract: a backend has to join against it on every admin request, and
 * `none` / `view` / `manage` needs to be a value the database can constrain.
 *
 * A master admin holds `manage` implicitly — the role is the grant — so their
 * rows are not consulted.
 */
export const adminAgentPermissions = pgTable(
  "admin_agent_permissions",
  {
    agentId: text("agent_id")
      .notNull()
      .references(() => adminAgents.id, { onDelete: "cascade" }),
    permission: adminPermissionEnum("permission").notNull(),
    level: adminPermissionLevelEnum("level").notNull().default("none"),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.permission] }),
    index("admin_agent_permissions_agent_idx").on(table.agentId),
  ],
);

/**
 * The audit trail. Append-only.
 *
 * The actor's name and role are copied onto the row rather than joined: an
 * audit record must still read correctly after the agent is renamed, demoted
 * or removed. It states what was true when the action was taken.
 *
 * INTEGRATION POINT: written server-side inside the same transaction as the
 * action it records, and read-only from the UI. It must never become editable
 * or deletable from the CRM.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    actorRole: adminRoleEnum("actor_role").notNull(),
    action: auditActionEnum("action").notNull(),
    targetType: auditTargetTypeEnum("target_type"),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    createdAt: ts("created_at").notNull(),
    ipAddress: text("ip_address").notNull(),
    outcome: auditOutcomeEnum("outcome").notNull().default("success"),
    /** Human-readable summary, including any reason the operator gave. */
    details: text("details").notNull(),
  },
  (table) => [
    index("audit_logs_created_idx").on(table.createdAt),
    index("audit_logs_actor_idx").on(table.actorId),
    index("audit_logs_action_idx").on(table.action),
    index("audit_logs_target_idx").on(table.targetType, table.targetId),
  ],
);

/**
 * Platform configuration — a single row, `id = 'default'`.
 *
 * Stored as one jsonb column per section rather than forty scalar columns.
 * The sections are read and written whole by the settings screen, they are
 * never filtered on, and each is typed against `PlatformSettings` so the shape
 * is still checked at compile time.
 *
 * INTEGRATION POINT: this table is the write side of the configuration service.
 * Until one exists, the user application still reads `@/constants/app`, so
 * editing settings here does not move the running app — see CLAUDE.md §15.8.
 */
export const platformSettings = pgTable("platform_settings", {
  id: text("id").primaryKey().default("default"),
  platform: jsonb("platform").$type<StoredPlatformSection>().notNull(),
  currency: jsonb("currency").$type<PlatformSettings["currency"]>().notNull(),
  withdrawals: jsonb("withdrawals")
    .$type<PlatformSettings["withdrawals"]>()
    .notNull(),
  deposits: jsonb("deposits").$type<PlatformSettings["deposits"]>().notNull(),
  investments: jsonb("investments")
    .$type<PlatformSettings["investments"]>()
    .notNull(),
  referrals: jsonb("referrals").$type<PlatformSettings["referrals"]>().notNull(),
  security: jsonb("security").$type<PlatformSettings["security"]>().notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: text("updated_by"),
});
