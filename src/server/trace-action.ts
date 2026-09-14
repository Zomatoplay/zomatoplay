import "server-only";

import { headers } from "next/headers";

import {
  describeError,
  errorDiagnostics,
  flushTraceAfterResponse,
  recordPipelineEvent,
  withTrace,
  type PipelineLayer,
} from "./observability";

/**
 * The wrapper every server action goes through.
 *
 * It opens a trace, records the action's own start and end with a measured
 * duration, and hands the buffered events to Next's post-response phase so
 * writing them costs the caller nothing.
 *
 * WHY THE CORRELATION ID CAN COME FROM THE CLIENT
 * -----------------------------------------------
 * The browser generates an id when a button is clicked and sends it in
 * `x-nanotron-correlation`. That is what joins the client-side half of the
 * trace — the click, the navigation — to the server-side half, so one filter
 * shows the whole chain rather than two disconnected halves.
 *
 * It is a **diagnostic label and nothing else**. It grants no access, selects
 * no data and is never used to look anything up; a caller who forges one has
 * mislabelled their own log rows. Anything a request is allowed to do still
 * comes from the session. It is length-capped and character-restricted below
 * so it cannot be used to smuggle text into the log.
 */

const CORRELATION_HEADER = "x-nanotron-correlation";
const ROUTE_HEADER = "x-nanotron-route";

/**
 * `redirect()` and `notFound()` signal by throwing.
 *
 * Recording those as failures would fill the log with "render failed" for every
 * unauthenticated visit and every 404 — the two most common non-events in the
 * application — and bury the real failures. They are re-thrown untouched; only
 * the label is different.
 */
function isControlFlow(error: unknown): boolean {
  const digest = (error as { digest?: unknown })?.digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND")
  );
}

/** Client-supplied labels are untrusted text; accept only an id-shaped one. */
function sanitiseCorrelationId(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return /^[A-Za-z0-9_-]{8,64}$/.test(trimmed) ? trimmed : undefined;
}

/** Same reasoning: a route label is for display, so keep it path-shaped. */
function sanitiseRoute(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return /^\/[A-Za-z0-9/_\-[\]().]{0,120}$/.test(trimmed) ? trimmed : undefined;
}

async function readRequestTrace(): Promise<{
  correlationId?: string;
  route?: string;
}> {
  try {
    const store = await headers();
    return {
      correlationId: sanitiseCorrelationId(store.get(CORRELATION_HEADER)),
      route:
        sanitiseRoute(store.get(ROUTE_HEADER)) ??
        // Next sets this on server-action requests; it is the page the action
        // was invoked from, which is exactly the route worth recording.
        sanitiseRoute(store.get("next-url")),
    };
  } catch {
    return {};
  }
}

/**
 * Traces one server action.
 *
 * Records `<name>.start` and `<name>.complete` / `.failed`, re-throws whatever
 * the work throws, and never lets an instrumentation failure surface.
 */
export async function traceAction<T>(
  options: {
    /** `kyc.submit`, `admin.withdrawal.reject`, … */
    name: string;
    actorType: "user" | "admin" | "system";
    pipeline: Parameters<typeof recordPipelineEvent>[0]["pipeline"];
    layer?: PipelineLayer;
  },
  work: () => Promise<T>,
): Promise<T> {
  const request = await readRequestTrace();

  return withTrace(
    {
      correlationId: request.correlationId,
      route: request.route ?? null,
      actorType: options.actorType,
    },
    async () => {
      const started = performance.now();
      recordPipelineEvent({
        pipeline: options.pipeline,
        layer: options.layer ?? "server",
        operation: `${options.name}.start`,
        status: "started",
        message: `Server action ${options.name} started`,
      });

      try {
        const result = await work();
        recordPipelineEvent({
          pipeline: options.pipeline,
          layer: options.layer ?? "server",
          operation: `${options.name}.complete`,
          status: "ok",
          message: `Server action ${options.name} completed`,
          durationMs: performance.now() - started,
        });
        await flushTraceAfterResponse();
        return result;
      } catch (error) {
        const controlFlow = isControlFlow(error);
        recordPipelineEvent({
          pipeline: options.pipeline,
          layer: options.layer ?? "server",
          operation: controlFlow
            ? `${options.name}.redirected`
            : `${options.name}.failed`,
          status: controlFlow ? "ok" : "failed",
          message: controlFlow
            ? `Server action ${options.name} redirected`
            : `Server action ${options.name} failed`,
          durationMs: performance.now() - started,
          // The whole cause chain. Drizzle's wrapper message is the SQL text;
          // the reason is a level below it, and recording only the wrapper is
          // what made a production connection fault unreadable for weeks.
          errorMessage: controlFlow ? null : describeError(error),
          metadata: controlFlow ? null : errorDiagnostics(error),
        });
        await flushTraceAfterResponse();
        throw error;
      }
    },
  );
}

/**
 * Traces a page or layout render.
 *
 * Same shape, different name, because "why is this page slow" and "why did this
 * action fail" are read differently even though the machinery is identical.
 */
export async function traceRender<T>(
  options: { route: string; actorType: "user" | "admin" | "system" },
  work: () => Promise<T>,
): Promise<T> {
  const request = await readRequestTrace();

  return withTrace(
    {
      correlationId: request.correlationId,
      route: options.route,
      actorType: options.actorType,
    },
    async () => {
      const started = performance.now();
      try {
        const result = await work();
        recordPipelineEvent({
          pipeline: "navigation",
          layer: "server",
          operation: "render.complete",
          status: "ok",
          message: `Rendered ${options.route}`,
          durationMs: performance.now() - started,
        });
        await flushTraceAfterResponse();
        return result;
      } catch (error) {
        const controlFlow = isControlFlow(error);
        recordPipelineEvent({
          pipeline: "navigation",
          layer: "server",
          operation: controlFlow ? "render.redirected" : "render.failed",
          status: controlFlow ? "ok" : "failed",
          message: controlFlow
            ? `${options.route} redirected`
            : `Render of ${options.route} failed`,
          durationMs: performance.now() - started,
          // The whole cause chain. Drizzle's wrapper message is the SQL text;
          // the reason is a level below it, and recording only the wrapper is
          // what made a production connection fault unreadable for weeks.
          errorMessage: controlFlow ? null : describeError(error),
          metadata: controlFlow ? null : errorDiagnostics(error),
        });
        await flushTraceAfterResponse();
        throw error;
      }
    },
  );
}
