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

  enqueueUntraced(row);
}

/* -------------------------------------------------------------------------- */
/* The untraced path                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Events recorded where there is no trace to buffer them into.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT ONE INSERT EACH ANY MORE
 * -----------------------------------------------------------
 * `AsyncLocalStorage` does not cross from a layout into the page beneath it:
 * Next renders them as separate work, so `traceRender` in `(app)/layout.tsx`
 * covers the layout's own body and nothing else. Every event a *page* recorded
 * — the session resolution, the account lookup, each service read — therefore
 * found no trace and took the immediate path, which was one `INSERT` per event.
 *
 * Measured on this deployment: five to eight single-row inserts per page
 * render, each a ~400ms round trip. They are fire-and-forget, so they do not
 * block directly — but they hold connections, and the pool is five. On the
 * wider pages (`/wallet`, `/referral`) three of them were in flight at exactly
 * the moment the page fired its parallel reads, so two of those reads waited a
 * whole round trip for a connection. Removing them was worth 15–25% there.
 *
 * Coalescing on a short timer restores rule 1 — one insert, not a dozen —
 * without needing a trace the render cannot give us. The window is deliberately
 * shorter than a round trip, so an event is never held longer than the request
 * that produced it would have taken anyway.
 */
const UNTRACED_BATCH_MS = 100;
/** Flushed early at this size, so a burst cannot grow without bound. */
const UNTRACED_BATCH_MAX = 50;

const untraced: PendingEvent[] = [];
let untracedTimer: ReturnType<typeof setTimeout> | null = null;

function flushUntraced(): void {
  void drainUntraced();
}

/** The same flush, awaitable. Used by `flushPipelineEvents()`. */
function drainUntraced(): Promise<void> {
  if (untracedTimer) {
    clearTimeout(untracedTimer);
    untracedTimer = null;
  }
  const rows = untraced.splice(0, untraced.length);
  return writeRows(rows);
}

/**
 * Writes anything still buffered, and waits for it.
 *
 * FOR SCRIPTS, NOT FOR REQUESTS. A request flushes through
 * `flushTraceAfterResponse()`, which hands the insert to `after()` so the user
 * waits for none of it; awaiting here would put instrumentation back on the
 * critical path, which rule 1 above exists to prevent.
 *
 * A CLI has no response to come after and no reason to stay alive for an
 * unref'd 100ms timer. Without this, `tron:inspect` recorded its TronGrid calls
 * on that timer, which fired *after* the script had closed the pool, reopened
 * it, and — with `idle_timeout: 0` — held the connections until the process was
 * killed. Draining before closing is what makes the script exit.
 */
export function flushPipelineEvents(): Promise<void> {
  return drainUntraced();
}

function enqueueUntraced(row: PendingEvent): void {
  untraced.push(row);
  if (untraced.length >= UNTRACED_BATCH_MAX) {
    flushUntraced();
    return;
  }
  if (untracedTimer) return;
  untracedTimer = setTimeout(flushUntraced, UNTRACED_BATCH_MS);
  // Never a reason for a script or a test to stay alive waiting on a log write.
  untracedTimer.unref?.();
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
      errorMessage: describeError(error),
      metadata: {
        ...(input.metadata ?? {}),
        errorCategory: category,
        expected: isExpected(category),
        ...errorDiagnostics(error),
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
/**
 * An error, written down with the reason underneath it.
 *
 * WHY THIS EXISTS — IT IS THE REASON A PRODUCTION FAULT WENT UNDIAGNOSED
 * ----------------------------------------------------------------------
 * This used to be `${error.name}: ${error.message}`, one level deep. Drizzle
 * wraps every driver failure in a `DrizzleQueryError` whose message is the SQL
 * text ("Failed query: select …") and whose `cause` carries the thing that
 * actually went wrong — the SQLSTATE, the severity, the driver's own words.
 * So every database failure in `pipeline_events` recorded the *query* and
 * threw away the *reason*.
 *
 * Concretely: five admin sign-in failures on 2026-09-14 were recorded as
 * "Failed query: select … from admin_agents …", which says nothing about why.
 * The cause was `PostgresError XX000 (EMAXCONNSESSION) max clients reached in
 * session mode`, and one line of it would have named the fault immediately.
 *
 * Walks up to four levels, which covers Drizzle → postgres.js and undici →
 * socket. Every level goes through `redact()`, because driver errors quote
 * what they were given.
 */
export function describeError(error: unknown, depth = 0): string {
  if (depth > 3) return "…";
  if (!(error instanceof Error)) return redact(String(error));

  const code = readCode(error);
  const head = `${error.name}${code ? ` (${code})` : ""}: ${error.message}`;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || cause === error) return redact(head);
  return redact(`${head}\ncaused by: ${describeError(cause, depth + 1)}`);
}

/**
 * The machine-readable half of the same thing.
 *
 * `errorMessage` is for a person reading the system log; these are for
 * filtering and grouping. Named scalars only — CLAUDE.md §22.2 — so nothing
 * here can carry a body, a parameter or a connection string.
 */
export function errorDiagnostics(
  error: unknown,
): Record<string, string | number | boolean> {
  const root = rootCause(error);
  const out: Record<string, string | number | boolean> = {};
  if (root instanceof Error) {
    out.errorName = root.name;
    const code = readCode(root);
    if (code) out.errorCode = code;
    const severity = (root as { severity_local?: unknown }).severity_local;
    if (typeof severity === "string") out.errorSeverity = severity;
  }
  return out;
}

/** The deepest `cause`, which is where a driver error's real code lives. */
function rootCause(error: unknown, depth = 0): unknown {
  if (depth > 3 || !(error instanceof Error)) return error;
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || cause === error) return error;
  return rootCause(cause, depth + 1);
}

function readCode(error: Error): string {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

/* -------------------------------------------------------------------------- */
/* The one fault this table cannot record about itself                        */
/* -------------------------------------------------------------------------- */

/**
 * A single structured stderr line for a failure to *acquire a connection*.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT AN EXCEPTION TO THE NO-LOGGING RULE
 * ----------------------------------------------------------------------
 * Every other signal in this file is written to `pipeline_events` — which is
 * written over the runtime pool, by `writeRows()` → `getDb().insert(...)`.
 * That is correct for everything the machinery does, and it is *structurally
 * incapable* of recording the one failure where the pool itself is
 * unavailable: the insert needs the connection that could not be got, fails
 * for the same reason, and is swallowed by design (rule 2 at the top of this
 * file).
 *
 * Verified, not assumed: after an `(EMAXCONNSESSION) max clients reached in
 * session mode` incident on this project, `pipeline_events` held **zero**
 * `database.connectRetry` rows and no matching text for the whole surrounding
 * week, although `resilientRead` classifies and retries that error correctly
 * and calls `recordPipelineEvent` on every retry. The incident erased its own
 * evidence, which is why it had to be diagnosed from a terminal scrollback.
 *
 * stderr is the only channel that survives a database that cannot be reached.
 * Vercel captures it in Runtime Logs; `next start` prints it.
 *
 * KEEPING IT QUIET
 * ----------------
 * Pool exhaustion arrives in bursts — every concurrent render fails at once —
 * so an unthrottled line here would be noise at exactly the moment the logs
 * need to be readable. One line per kind per `FAULT_LOG_WINDOW_MS`, with the
 * suppressed count carried on the next one that gets through, so a burst reads
 * as a burst rather than as a single event.
 *
 * It carries named scalars and a `redact()`ed message, the same rule §22.2
 * applies to `metadata`. No cookie, token, key, connection string or bound
 * parameter reaches it.
 */
const FAULT_LOG_WINDOW_MS = Number(
  process.env.DATABASE_FAULT_LOG_WINDOW_MS ?? 30_000,
);

const faultLog = new Map<string, { at: number; suppressed: number }>();

export function reportInfrastructureFault(fault: {
  /** A stable, low-cardinality label, e.g. `pool_exhausted`. */
  kind: string;
  /** What was being attempted — an operation name, never a payload. */
  operation: string;
  error: unknown;
  /** Named scalars only. */
  detail?: Record<string, string | number | boolean | null | undefined>;
}): void {
  try {
    const now = Date.now();
    const seen = faultLog.get(fault.kind);
    if (seen && now - seen.at < FAULT_LOG_WINDOW_MS) {
      seen.suppressed += 1;
      return;
    }
    faultLog.set(fault.kind, { at: now, suppressed: 0 });

    const line = {
      event: "infrastructure.fault",
      kind: fault.kind,
      operation: fault.operation,
      correlationId: currentCorrelationId(),
      ...(seen && seen.suppressed > 0
        ? { suppressedSinceLastLine: seen.suppressed }
        : {}),
      ...fault.detail,
      error: redact(describeError(fault.error)).slice(0, 500),
    };
    // Deliberately one line of JSON: greppable, parseable by a log drain, and
    // impossible to interleave with another request's output.
    console.error(JSON.stringify(line));
  } catch {
    // Diagnosing a fault must never become a second fault.
  }
}

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
    /*
     * The bound parameters of a failed statement.
     *
     * Drizzle's `DrizzleQueryError` message is the SQL followed by a
     * `params:` line carrying the actual values — so a failed account lookup
     * wrote a real `auth_user_id` into `pipeline_events`, and a failed deposit
     * read wrote a user id and an address. None of it is a credential, which
     * is why the rules above never caught it, and all of it is
     * account-identifying data in a diagnostics table an operator browses.
     * §22.2's rule is that `metadata` carries *named scalars* rather than raw
     * payloads, and this is the one path that was smuggling a payload past it.
     *
     * The SQL itself is kept: knowing which statement failed is the whole
     * diagnostic value, and it is schema, not data. Only the values go.
     *
     * This matters more since error recording began walking the whole cause
     * chain — that reaches the driver error, which is exactly the level that
     * quotes its parameters.
     */
    .replace(/\bparams:[^\n]*/gi, "params: [redacted]")
    .slice(0, 2000);
}
