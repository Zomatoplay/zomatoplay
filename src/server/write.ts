import "server-only";

import { getDb, isDatabaseConfigured, type Tx } from "@/db";
import * as t from "@/db/schema";
import type { AdminRole, AuditAction, AuditLogEntry } from "@/types/admin";

/**
 * The transactional, audited unit of work.
 *
 * Everything that changes data goes through `mutate()`. It exists to make three
 * properties structural rather than remembered:
 *
 * 1. **Atomicity.** The callback runs inside one database transaction. A
 *    deposit that credits a wallet writes a ledger row, a balance update and a
 *    deposit status change; either all three land or none do. A partial credit
 *    is a discrepancy nobody can reconcile afterwards.
 *
 * 2. **Auditability.** Audit entries are buffered on the context and written
 *    *inside the same transaction*, immediately before it commits. That is the
 *    same guarantee the CRM's in-memory store already made — the write and its
 *    audit record are one transaction, never two call sites that can drift —
 *    now enforced by Postgres instead of by a reducer.
 *
 * 3. **A named actor.** Nothing writes anonymously. There is no authentication
 *    yet, so the actor is a fixed system or demo principal, but the shape is
 *    the real one: when sessions arrive, the actor comes from the session and
 *    nothing below this line changes.
 *
 * Writes have no seed-data fallback, deliberately. A read can fall back to
 * `@/data` and be merely stale; a write that "succeeds" against mock data has
 * told the caller something false. With no database configured, `mutate()`
 * refuses.
 */

export interface Actor {
  kind: "system" | "agent" | "user";
  id: string;
  name: string;
  role: AdminRole;
  /** A real deployment records the request's source address. */
  ipAddress?: string;
}

/** The scanner, a scheduler — anything with no human behind it. */
export const SYSTEM_ACTOR: Actor = {
  kind: "system",
  id: "system",
  name: "System",
  role: "master_admin",
};

export interface AuditDraft {
  action: AuditAction;
  target: AuditLogEntry["target"];
  details: string;
  outcome?: AuditLogEntry["outcome"];
}

export interface WriteContext {
  tx: Tx;
  actor: Actor;
  /**
   * One instant for the whole unit of work, so every row it writes agrees on
   * when it happened. Rows stamped from separate `new Date()` calls disagree by
   * milliseconds, which is enough to make an audit trail read out of order.
   */
  now: Date;
  /** Queues an audit entry. Written with the rest of the transaction. */
  audit: (draft: AuditDraft) => void;
}

export class WritesUnavailableError extends Error {
  constructor() {
    super(
      "No DATABASE_URL is configured, so there is nowhere to write. Reads fall " +
        "back to the seed data in src/data; writes do not, because a write that " +
        "appears to succeed against mock data is a lie.",
    );
    this.name = "WritesUnavailableError";
  }
}

export async function mutate<T>(
  actor: Actor,
  work: (ctx: WriteContext) => Promise<T>,
): Promise<T> {
  if (!isDatabaseConfigured()) {
    throw new WritesUnavailableError();
  }

  return getDb().transaction(async (tx) => {
    const now = new Date();
    const entries: AuditDraft[] = [];

    const result = await work({
      tx,
      actor,
      now,
      audit: (draft) => entries.push(draft),
    });

    if (entries.length > 0) {
      await tx.insert(t.auditLogs).values(
        entries.map((entry, index) => ({
          id: auditId(now, index),
          actorId: actor.id,
          // Copied, not joined: an audit record has to keep reading correctly
          // after the actor is renamed, demoted or removed.
          actorName: actor.name,
          actorRole: actor.role,
          action: entry.action,
          targetType: entry.target?.type ?? null,
          targetId: entry.target?.id ?? null,
          targetLabel: entry.target?.label ?? null,
          createdAt: new Date(now.getTime() + index),
          ipAddress: actor.ipAddress ?? "0.0.0.0",
          outcome: entry.outcome ?? "success",
          details: entry.details,
        })),
      );
    }

    return result;
  });
}

/**
 * Appends an operator's stated reason to an audit detail line.
 *
 * Confirmation dialogs promise the operator that their reason is recorded.
 * Joining it here rather than at each call site is what keeps that promise from
 * depending on whoever wrote the newest action remembering to.
 */
export function withReason(details: string, reason?: string | null): string {
  const trimmed = reason?.trim();
  return trimmed ? `${details} Reason: ${trimmed}` : details;
}

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Sortable, collision-resistant ids.
 *
 * Time-prefixed so rows sort by creation in an index and are readable in a log
 * line, with random suffix bits so two writers in the same millisecond do not
 * collide. `randomUUID` would do, but these keep the "recognisable without a
 * join" property the seeded ids have.
 */
export function newId(prefix: string, at: Date = new Date()): string {
  const time = at.getTime().toString(36);
  const random = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(5, "0");
  return `${prefix}_${time}${random}`;
}

function auditId(at: Date, index: number): string {
  return newId("aud", new Date(at.getTime() + index));
}
