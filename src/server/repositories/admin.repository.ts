import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { AdminAgent, AuditLogEntry, PlatformSettings } from "@/types/admin";

import { toAuditLogEntry, toPermissionSet, toPlatformSettings } from "./mappers";

/** Operators, the audit trail and platform configuration. */

/**
 * The permission ids, taken from the database enum rather than from
 * `@/constants/admin`.
 *
 * Same list — the two are pinned to each other by a type assertion in
 * `db/schema/enums.ts` — but that module also carries the CRM's navigation
 * icons, and a repository has no business pulling a UI dependency into the
 * server bundle to find out what a column can contain. The enum *is* what the
 * column can contain.
 */
const PERMISSION_IDS = schema.adminPermissionEnum.enumValues;

/**
 * The operator directory with each agent's grants.
 *
 * Permissions are fetched as one flat query and grouped, rather than a query
 * per agent: the agents screen renders the whole matrix at once.
 */
export async function listAdminAgents(db: Database): Promise<AdminAgent[]> {
  const agents = await db
    .select()
    .from(schema.adminAgents)
    .orderBy(asc(schema.adminAgents.createdAt));
  if (agents.length === 0) return [];

  const grants = await db.select().from(schema.adminAgentPermissions);

  const grantsByAgent = new Map<string, typeof grants>();
  for (const grant of grants) {
    const bucket = grantsByAgent.get(grant.agentId) ?? [];
    bucket.push(grant);
    grantsByAgent.set(grant.agentId, bucket);
  }

  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    email: agent.email,
    role: agent.role,
    status: agent.status,
    createdAt: agent.createdAt.toISOString(),
    lastActiveAt: agent.lastActiveAt?.toISOString() ?? null,
    permissions: toPermissionSet(grantsByAgent.get(agent.id) ?? [], PERMISSION_IDS),
    note: agent.note ?? undefined,
    passwordResetRequestedAt:
      agent.passwordResetRequestedAt?.toISOString() ?? null,
  }));
}

/**
 * The audit trail, newest first.
 *
 * Read-only by design: nothing in this repository updates or deletes an entry,
 * and nothing should be added that does.
 */
export async function listAuditLog(
  db: Database,
  limit = 500,
): Promise<AuditLogEntry[]> {
  const rows = await db
    .select()
    .from(schema.auditLogs)
    .orderBy(desc(schema.auditLogs.createdAt))
    .limit(limit);
  return rows.map(toAuditLogEntry);
}

/** Platform configuration. One row, `id = 'default'`. */
export async function findPlatformSettings(
  db: Database,
): Promise<PlatformSettings | null> {
  const [row] = await db
    .select()
    .from(schema.platformSettings)
    .where(eq(schema.platformSettings.id, "default"))
    .limit(1);
  return row ? toPlatformSettings(row) : null;
}
