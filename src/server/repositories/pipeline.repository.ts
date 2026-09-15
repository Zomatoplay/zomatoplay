import "server-only";

import { desc, eq, inArray, lt } from "drizzle-orm";

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

/**
 * Deletes one batch of diagnostics older than `cutoff`, returning how many
 * rows went.
 *
 * BATCHED, AND THAT IS THE POINT
 * ------------------------------
 * A single `delete from pipeline_events where occurred_at < $1` is one
 * statement and one very long transaction: it takes row locks on everything it
 * removes and holds a connection out of a five-connection pool (CLAUDE.md
 * §16.1a) for as long as it runs. On the first prune of a table that has never
 * been pruned that is tens of thousands of rows at once.
 *
 * Deleting a bounded slice at a time keeps each transaction short, lets the
 * caller stop when it has done enough, and makes an interrupted run
 * harmless — the next pass simply continues, because "older than the cutoff"
 * stays true for whatever is left.
 *
 * `occurred_at` is indexed (`pipeline_events_occurred_idx`), so selecting the
 * batch is a range scan rather than a table scan.
 */
export async function deleteOldPipelineEvents(
  db: Database,
  cutoff: Date,
  batchSize: number,
): Promise<number> {
  const deleted = await db
    .delete(schema.pipelineEvents)
    .where(
      inArray(
        schema.pipelineEvents.id,
        db
          .select({ id: schema.pipelineEvents.id })
          .from(schema.pipelineEvents)
          .where(lt(schema.pipelineEvents.occurredAt, cutoff))
          .limit(batchSize),
      ),
    )
    .returning({ id: schema.pipelineEvents.id });

  return deleted.length;
}
