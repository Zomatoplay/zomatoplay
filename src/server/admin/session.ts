import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";
import { buildPermissionSet } from "@/constants/admin";
import type {
  AdminPermissionId,
  AdminPermissionLevel,
  AdminSession,
} from "@/types/admin";
import { getAuthPrincipal } from "@/server/auth/session";
import { resilientRead } from "@/server/database";
import { describeTraceActor, trackQuery } from "@/server/observability";
import type { Actor } from "@/server/write";

/**
 * Who the operator is.
 *
 * WHAT THIS CLOSES
 * ----------------
 * The Master CRM's permission model was already enforced server-side: every
 * operator action loaded the agent from the database and checked the stored
 * level. What it could not do was establish *which* agent was calling. The id
 * arrived from the browser — the demo session switcher in the header — so the
 * model was real and the identity behind it was decoration. A caller could name
 * themselves the master admin and approve a verification case, credit a
 * deposit or unblock an account.
 *
 * Operator identity now comes from the same place user identity does: a
 * verified Supabase session, resolved through
 * `auth.users.id → admin_agents.auth_user_id`. There is no parameter to
 * tamper with, because there is no parameter.
 *
 * TWO AUTHORITIES, ONE CREDENTIAL STORE
 * -------------------------------------
 * A Supabase principal can be a user, an operator, both or neither — the two
 * lookups are independent and neither implies the other. Signing in at `/login`
 * does not make somebody an operator, and an operator account is not
 * automatically a customer account. That is deliberate: the alternative, a
 * `role` column on `public.users`, makes every customer row one UPDATE away
 * from being an administrator.
 */

export class AdminAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminAuthorizationError";
  }
}

/** Raised when there is no operator session at all, as opposed to a weak one. */
export class NotAuthenticatedOperatorError extends AdminAuthorizationError {
  constructor() {
    super("Not signed in as an operator.");
    this.name = "NotAuthenticatedOperatorError";
  }
}

export interface Operator {
  actor: Actor;
  agentId: string;
  name: string;
  email: string;
  role: "master_admin" | "agent";
  permissions: Partial<Record<AdminPermissionId, AdminPermissionLevel>>;
}

/**
 * The signed-in operator, or null.
 *
 * Null means "no operator session" and never "assume the master admin". The
 * console used to open as the master admin so every screen was reachable; it
 * now opens at `/admin/login`.
 */
export async function getCurrentOperator(): Promise<Operator | null> {
  // Resolved here, before the cached lookup, so both steps stay in this
  // request's trace — React's `cache()` runs its function in its own async
  // context and anything recorded inside it loses the trace.
  const principal = await getAuthPrincipal();
  if (!principal || !isDatabaseConfigured()) return null;

  const operator = await trackQuery(
    "admin.resolveOperator",
    () => loadOperator(principal.authUserId),
    { table: "admin_agents", pipeline: "admin" },
  );
  if (operator) {
    describeTraceActor({
      actorId: operator.agentId,
      actorName: operator.name,
      actorType: "admin",
    });
  }
  return operator;
}

const loadOperator = cache(
  async function loadOperator(authUserId: string): Promise<Operator | null> {
  const db = getDb();

  /*
   * The agent and their grants in one round trip.
   *
   * These were two sequential queries — find the agent, then read its
   * permissions — which cost two ~200ms round trips on every admin request,
   * including ones that turn out not to be an operator at all. A left join
   * returns one row per grant and the map is rebuilt below; thirteen rows is
   * nothing to transfer and one round trip is half the latency.
   *
   * A **left** join, so an operator with no grants at all still resolves. That
   * is a real state — a master admin's rows are never consulted — and an inner
   * join would have made them invisible to themselves.
   */
  // Deadline and bounded connection retry, for the same reason the customer
  // account lookup has them: this gates every console page, and without a
  // deadline one unhealthy pooler endpoint hangs the request rather than
  // failing it. A read, so retrying is safe.
  const rows = await resilientRead(async () =>
      db
        .select({
          id: t.adminAgents.id,
          name: t.adminAgents.name,
          email: t.adminAgents.email,
          role: t.adminAgents.role,
          status: t.adminAgents.status,
          permission: t.adminAgentPermissions.permission,
          level: t.adminAgentPermissions.level,
        })
        .from(t.adminAgents)
        .leftJoin(
          t.adminAgentPermissions,
          eq(t.adminAgentPermissions.agentId, t.adminAgents.id),
        )
        .where(eq(t.adminAgents.authUserId, authUserId)));

  const agent = rows[0];

  // A valid Supabase session that belongs to no operator row. Common and
  // correct: it is what an ordinary customer's session looks like here.
  if (!agent) return null;

  // A disabled operator keeps their rows — audit entries have to keep pointing
  // somewhere — and loses their access.
  if (agent.status !== "active") {
    throw new AdminAuthorizationError(
      `That operator account is ${agent.status}. Contact the master admin.`,
    );
  }

  const permissions: Partial<Record<AdminPermissionId, AdminPermissionLevel>> = {};
  for (const row of rows) {
    if (row.permission) permissions[row.permission] = row.level ?? "none";
  }

  return {
    agentId: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    permissions,
    actor: {
      kind: "agent",
      id: agent.id,
      name: agent.name,
      role: agent.role,
    },
  };
  },
);

export async function requireOperator(): Promise<Operator> {
  const operator = await getCurrentOperator();
  if (!operator) throw new NotAuthenticatedOperatorError();
  return operator;
}

/** True when the operator holds at least `level` over `permission`. */
export function operatorHolds(
  operator: Operator,
  permission: AdminPermissionId,
  level: Exclude<AdminPermissionLevel, "none"> = "manage",
): boolean {
  // A master admin holds `manage` implicitly — the role is the grant, and
  // their permission rows are not consulted. CLAUDE.md §15.3.
  if (operator.role === "master_admin") return true;
  const held = operator.permissions[permission] ?? "none";
  return level === "view" ? held === "view" || held === "manage" : held === "manage";
}

/**
 * The gate every operator mutation passes through.
 *
 * Resolves the session and asserts the permission in one step, so there is no
 * arrangement of calls that authenticates without authorizing.
 */
export async function requirePermission(
  permission: AdminPermissionId,
  level: Exclude<AdminPermissionLevel, "none"> = "manage",
): Promise<Operator> {
  const operator = await requireOperator();

  if (!operatorHolds(operator, permission, level)) {
    throw new AdminAuthorizationError(
      `${operator.name} does not have ${level} access to ${permission}.`,
    );
  }

  return operator;
}

/**
 * What the client is told about its own operator session.
 *
 * The operator's own identity and grants, and nothing about anyone else's. The
 * client uses it to hide destinations and disable controls — an affordance, so
 * an honest operator can see what they may do. It is not the boundary; the
 * boundary is `requirePermission` above, on the server, on every mutation.
 *
 * Missing grants are filled in as `none` so the shape matches `AdminSession`,
 * which the existing permission helpers and every screen already read.
 */
export function toSessionView(operator: Operator): AdminSession {
  return {
    agentId: operator.agentId,
    name: operator.name,
    email: operator.email,
    role: operator.role,
    permissions: { ...buildPermissionSet("none"), ...operator.permissions },
  };
}
