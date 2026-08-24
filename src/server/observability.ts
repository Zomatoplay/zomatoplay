import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { getDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";

import { classifyError, isExpected } from "./errors";
import { newId, type Actor } from "./write";

/**
 * Pipeline instrumentation — the technical execution trail.
 *
 * The question this exists to answer is "what happened when I clicked Submit
 * KYC, and where did the time go?", without anybody reconstructing it from
 * timestamps. Each step of a request writes one row carrying the same
 * correlation id, a layer and a measured duration, so the whole request is one
 * filter and one ordered read in `/admin/system-logs`.
 *
 * FOUR RULES, AND WHY EACH ONE MATTERS
 * ------------------------------------
 * 1. **Recording is never on the critical path.** Events are buffered in the
 *    request's async context and written *after the response*, in one
 *    multi-row insert. This is not a micro-optimisation: a round trip to this
 *    database costs ~200ms, so a dozen synchronous inserts would have made the
 *    application several times slower than the problem they were added to
 *    diagnose. Instrumentation that changes what it measures is worthless.
 *
 * 2. **Recording never breaks the thing it records.** Every write is wrapped in
 *    try/catch and swallowed. An observability table that can fail a KYC
 *    submission has traded reliability for insight, which is the wrong way
 *    round.
 *
 * 3. **It writes outside the caller's transaction.** Deliberately: a failed
 *    operation rolls its transaction back, and the record of the failure must
 *    survive that. Audit entries go *inside* the transaction because they
 *    describe a decision that either happened or did not; pipeline events
 *    describe an attempt, and a rolled-back attempt is the interesting kind.
 *
 * 4. **Nothing sensitive goes in.** No tokens, passwords, API keys, private
 *    keys, whole account or document numbers, or request bodies. `metadata`
 *    takes named scalars only, and `redact()` is the backstop for text this
 *    code did not compose.
 */

/* -------------------------------------------------------------------------- */
/* The request-scoped trace                                                    */
/* -------------------------------------------------------------------------- */

interface Trace {
  correlationId: string;
  route: string | null;
  actorType: (typeof t.pipelineActorTypeEnum.enumValues)[number];
  userId: string | null;
  actorId: string | null;
  actorName: string | null;
  buffer: PendingEvent[];
  /** Set once the buffer has been handed to a flush, so it is not written twice. */
  flushed: boolean;
}

type PendingEvent = typeof t.pipelineEvents.$inferInsert;

const traceStore = new AsyncLocalStorage<Trace>();

/**
 * Runs `work` inside a trace, flushing whatever it recorded afterwards.
 *
 * `AsyncLocalStorage` rather than a threaded parameter: the alternative is a
 * `correlationId` argument on every service and repository function, which
 * would be forgotten exactly where it matters and would put a diagnostic
 * concern into every signature in the codebase.
 *
 * Nested calls join the existing trace rather than starting a new one, so a
 * service that instruments itself does not fragment its caller's request into
 * several unrelated traces.
 */
export async function withTrace<T>(
  options: {
    correlationId?: string;
    route?: string | null;
    actorType?: Trace["actorType"];
  },
  work: (correlationId: string) => Promise<T>,
): Promise<T> {
  const existing = traceStore.getStore();
  if (existing) {
    // Fill in anything the outer scope did not know yet.
    if (options.route && !existing.route) existing.route = options.route;
    return work(existing.correlationId);
  }

  const trace: Trace = {
    correlationId: options.correlationId ?? newCorrelationId(),
    route: options.route ?? null,
    actorType: options.actorType ?? "system",
    userId: null,
    actorId: null,
    actorName: null,
    buffer: [],
    flushed: false,
  };

  try {
    return await traceStore.run(trace, () => work(trace.correlationId));
  } finally {
    // Scheduled and scripted work has no response to come after, so it flushes
    // here. A request flushes earlier, via `flushTraceAfterResponse()`.
    await flushTrace(trace);
  }
}

export function newCorrelationId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** The current correlation id, or a fresh standalone one. */
export function currentCorrelationId(): string {
  return traceStore.getStore()?.correlationId ?? newCorrelationId();
}

/**
 * Records who the request turned out to be, once that is known.
 *
 * Called from the auth resolution rather than passed in, because the identity
 * is not known when the trace opens — resolving it is one of the steps being
 * traced.
 */
export function describeTraceActor(actor: {
  userId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorType?: Trace["actorType"];
}): void {
  const trace = traceStore.getStore();
  if (!trace) return;
  if (actor.userId !== undefined) trace.userId = actor.userId;
  if (actor.actorId !== undefined) trace.actorId = actor.actorId;
  if (actor.actorName !== undefined) trace.actorName = actor.actorName;
  if (actor.actorType) trace.actorType = actor.actorType;
}

/* -------------------------------------------------------------------------- */
/* Recording                                                                   */
/* -------------------------------------------------------------------------- */

export type Pipeline = (typeof t.pipelineEnum.enumValues)[number];
export type PipelineLayer = (typeof t.pipelineLayerEnum.enumValues)[number];
export type PipelineStatus = (typeof t.pipelineStatusEnum.enumValues)[number];

export interface PipelineEventInput {
  pipeline: Pipeline;
  layer?: PipelineLayer;
  /**
   * Overrides the trace's id for this one event.
   *
   * Used when a batch of events is being recorded on behalf of *other*
   * requests — the browser posts its client-side events after the fact, and
   * each belongs to the navigation it described, not to the upload.
   */
  correlationId?: string;
  /** `area.verb`, e.g. `kyc.submit`, `db.users.findByAuthId`, `auth.getUser`. */
  operation: string;
  status: PipelineStatus;
  message: string;
  durationMs?: number;
  route?: string | null;
  userId?: string | null;
  actor?: Pick<Actor, "id" | "name"> | null;
  subject?: { type: string; id: string } | null;
  errorMessage?: string | null;
  metadata?: Record<string, string | number | boolean> | null;
}

function toRow(input: PipelineEventInput, trace: Trace | undefined): PendingEvent {
  const now = new Date();
  return {
    id: newId("evt", now),
    pipeline: input.pipeline,
    layer: input.layer ?? "server",
    operation: input.operation,
    status: input.status,
    route: input.route ?? trace?.route ?? null,
    actorType: trace?.actorType ?? "system",
    occurredAt: now,
    durationMs:
      input.durationMs === undefined ? null : Math.round(input.durationMs),
    correlationId: input.correlationId ?? trace?.correlationId ?? newCorrelationId(),
    userId: input.userId ?? trace?.userId ?? null,
    actorId: input.actor?.id ?? trace?.actorId ?? null,
    actorName: input.actor?.name ?? trace?.actorName ?? null,
    subjectType: input.subject?.type ?? null,
    subjectId: input.subject?.id ?? null,
    message: input.message,
    errorMessage: input.errorMessage ? redact(input.errorMessage) : null,
    metadata: input.metadata ?? null,
  };
}

/**
 * Buffers an event, or writes it immediately when there is no trace.
 *
 * The immediate path exists for things that happen outside a request — a
 * script, a scheduler — and is fire-and-forget so it cannot stall a caller.
 */
export function recordPipelineEvent(input: PipelineEventInput): void {
  if (!isDatabaseConfigured()) return;

  const trace = traceStore.getStore();
  const row = toRow(input, trace);

  if (trace && !trace.flushed) {
    trace.buffer.push(row);
    return;
  }

  void writeRows([row]);
}

/**
 * Times an operation and records how it went.
 *
 * A failure is re-thrown after being recorded — this observes, it does not
 * handle. Swallowing here would turn every instrumented call into one that
 * silently succeeds.
 */
export async function trackPipeline<T>(
  input: Omit<PipelineEventInput, "status" | "durationMs" | "errorMessage"> & {
    /** Message used when it succeeds. Defaults to `message`. */
    successMessage?: string;
  },
  work: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await work();
    recordPipelineEvent({
      ...input,
      status: "ok",
      message: input.successMessage ?? input.message,
      durationMs: performance.now() - started,
    });
    return result;
  } catch (error) {
    /*
     * The category is what makes this log readable.
     *
     * "failed" alone puts an absent session, a refused permission and a database
     * outage in one bucket. Sorting by `errorCategory` separates the routine
     * from the alarming — and `expected` marks the ones nobody should be paged
     * for.
     */
    const category = classifyError(error);
    recordPipelineEvent({
      ...input,
      status: "failed",
      durationMs: performance.now() - started,
      errorMessage:
        error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      metadata: {
        ...(input.metadata ?? {}),
        errorCategory: category,
        expected: isExpected(category),
      },
    });
    throw error;
  }
}

/**
 * Times a database operation.
 *
 * Thin on purpose — it exists so every query in the system reports its cost the
 * same way and under a stable identifier, which is what makes "which query is
 * slow" answerable by sorting a column rather than by reading code.
 */
export function trackQuery<T>(
  operation: string,
  work: () => Promise<T>,
  options: { table?: string; pipeline?: Pipeline; rows?: () => number } = {},
): Promise<T> {
  return trackPipeline(
    {
      pipeline: options.pipeline ?? "database",
      layer: "database",
      operation,
      message: operation,
      metadata: options.table ? { table: options.table } : null,
    },
    work,
  );
}

/* -------------------------------------------------------------------------- */
/* Flushing                                                                    */
/* -------------------------------------------------------------------------- */

async function writeRows(rows: PendingEvent[]): Promise<void> {
  if (rows.length === 0 || !isDatabaseConfigured()) return;
  try {
    // One insert for the whole request. Twelve separate inserts would cost
    // twelve round trips — more than the request they describe.
    await getDb().insert(t.pipelineEvents).values(rows);
  } catch {
    // Rule 2. The operations these describe have already happened, and
    // reporting a logging failure would be a strictly worse lie than not
    // logging at all.
  }
}

async function flushTrace(trace: Trace): Promise<void> {
  if (trace.flushed) return;
  trace.flushed = true;
  const rows = trace.buffer.splice(0, trace.buffer.length);
  // Stamp the identity onto rows recorded before it was known.
  for (const row of rows) {
    row.userId ??= trace.userId;
    row.actorId ??= trace.actorId;
    row.actorName ??= trace.actorName;
    row.route ??= trace.route;
    row.actorType = trace.actorType;
  }
  await writeRows(rows);
}

/**
 * Hands the current trace's buffer to Next's post-response phase.
 *
 * `after()` runs once the response has been streamed, so the insert costs the
 * user nothing. Called by the request entry points; safe to call more than
 * once, and a no-op outside a request.
 */
export async function flushTraceAfterResponse(): Promise<void> {
  const trace = traceStore.getStore();
  if (!trace || trace.flushed || trace.buffer.length === 0) return;

  try {
    const { after } = await import("next/server");
    const rows = trace.buffer.splice(0, trace.buffer.length);
    trace.flushed = true;
    for (const row of rows) {
      row.userId ??= trace.userId;
      row.actorId ??= trace.actorId;
      row.actorName ??= trace.actorName;
      row.route ??= trace.route;
      row.actorType = trace.actorType;
    }
    after(() => writeRows(rows));
  } catch {
    // No request scope, or `after` unavailable. The trace flushes on close.
  }
}

/* -------------------------------------------------------------------------- */
/* Redaction                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Strips anything that looks like a credential out of an error message.
 *
 * Driver and HTTP errors quote what they were given. A postgres.js connection
 * failure includes the connection string; a fetch failure can include a query
 * string carrying a key. Neither belongs in a table an operator browses.
 *
 * A denylist is not a guarantee, which is why the *positive* rule — record only
 * named, non-sensitive fields — is the one doing the real work. This is the
 * backstop for text this code did not compose.
 */
export function redact(message: string): string {
  return message
    .replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgres://[redacted]")
    .replace(
      /\b(apikey|api_key|authorization|bearer|token|password|secret|refresh_token|access_token)\b\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
      "[redacted-jwt]",
    )
    // Supabase publishable/secret keys and similar opaque prefixed tokens.
    .replace(/\b(sb|sk|pk)_[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .slice(0, 2000);
}
