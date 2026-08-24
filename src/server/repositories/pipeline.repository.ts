import "server-only";

import { desc, eq } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { PipelineEvent } from "@/types/admin";

/**
 * The system log.
 *
 * Bounded by default, and that is not a nicety: this table grows with every
 * request the instrumented paths serve, so an unbounded `select *` would be
 * fine on the development dataset and would take the screen down the first
 * week it saw traffic. The CRM filters client-side within this window, which
 * is the same trade every other admin list makes.
 */

/**
 * How many events the log screen loads.
 *
 * Measured: 500 rows made `/admin/system-logs` the slowest page in the
 * application at ~3,000ms, because each row carries a jsonb `metadata` column
 * and the whole set crosses the wire. 200 is still far more than anybody reads
 * in one sitting, and the correlation filter — the view that actually matters
 * for debugging — fetches only one request's steps.
 */
const DEFAULT_LIMIT = 200;

export interface PipelineEventFilters {
  /** Narrow to one request's complete execution chain. */
  correlationId?: string;
}

export async function listPipelineEvents(
  db: Database,
  options: { limit?: number; correlationId?: string } = {},
): Promise<PipelineEvent[]> {
  const rows = await db
    .select({
      event: schema.pipelineEvents,
      userName: schema.users.fullName,
      userDisplayId: schema.users.displayId,
    })
    .from(schema.pipelineEvents)
    // A **left** join: most events concern no account at all (a scanner pass, a
    // failed sign-in with no resolved user), and an inner join would drop
    // exactly the infrastructure events this screen exists to show.
    .leftJoin(schema.users, eq(schema.users.id, schema.pipelineEvents.userId))
    .where(
      options.correlationId
        ? eq(schema.pipelineEvents.correlationId, options.correlationId)
        : undefined,
    )
    .orderBy(desc(schema.pipelineEvents.occurredAt))
    .limit(options.limit ?? DEFAULT_LIMIT);

  return rows.map(({ event, userName, userDisplayId }) => ({
    id: event.id,
    pipeline: event.pipeline,
    layer: event.layer,
    route: event.route,
    actorType: event.actorType,
    operation: event.operation,
    status: event.status,
    occurredAt: event.occurredAt.toISOString(),
    durationMs: event.durationMs,
    correlationId: event.correlationId,
    userId: event.userId,
    userLabel: userName ? `${userName} · ${userDisplayId}` : null,
    actorId: event.actorId,
    actorName: event.actorName,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    message: event.message,
    errorMessage: event.errorMessage,
    metadata: event.metadata,
  }));
}
