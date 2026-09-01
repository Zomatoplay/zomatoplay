import { after, NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedAccount } from "@/server/auth/account";
import { recordPipelineEvent, withTrace } from "@/server/observability";

/**
 * Where the browser's half of a trace arrives.
 *
 * The server can time everything it does, but it cannot see the click that
 * started it or the paint that ended it. Those two events are what turn "the
 * server took 400ms" into "the user waited 900ms", and they can only come from
 * the browser.
 *
 * BATCHED, AND SENT WHEN THE NAVIGATION IS ALREADY OVER
 * -----------------------------------------------------
 * The client buffers its events and posts them once, after the navigation has
 * completed — usually via `sendBeacon`, which the browser sends without the
 * page waiting. Nothing here is on the critical path of anything the user is
 * waiting for.
 *
 * EVERYTHING IN THE BODY IS UNTRUSTED
 * -----------------------------------
 * This endpoint writes rows into a table operators read, from a body anybody
 * can post. So it validates rather than trusts:
 *
 *  - `operation` must be one of a fixed set of names. Free text would let a
 *    caller write whatever they liked into the log, which is how a debugging
 *    tool becomes a place to hide things or to fake a story.
 *  - `durationMs` is clamped to something a navigation could plausibly take.
 *  - the batch is capped, so one caller cannot flood the table.
 *  - `userId` is taken from the *session*, never from the body.
 *
 * It is deliberately reachable without a session: an unauthenticated visit to
 * `/login` is a navigation worth timing too. What an anonymous caller can
 * achieve is writing a bounded number of fixed-shape rows attributed to nobody.
 */

/** The only client events that may be recorded. */
const ALLOWED_OPERATIONS = new Set([
  "navigation.start",
  "navigation.complete",
  "navigation.failed",
  "action.start",
  "action.complete",
  "action.failed",
  "request.start",
  "request.complete",
  "request.failed",
]);

const MAX_EVENTS = 20;
const MAX_DURATION_MS = 120_000;

interface ClientEvent {
  operation: string;
  status: "started" | "ok" | "failed";
  durationMs?: number;
  route?: string;
  label?: string;
  correlationId?: string;
}

function sanitiseCorrelationId(raw: unknown): string | undefined {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw)
    ? raw
    : undefined;
}

function sanitiseRoute(raw: unknown): string | undefined {
  return typeof raw === "string" && /^\/[A-Za-z0-9/_\-[\]().]{0,120}$/.test(raw)
    ? raw
    : undefined;
}

/** A short, plain label. Not free-form text: it is displayed to an operator. */
function sanitiseLabel(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().slice(0, 60);
  return /^[A-Za-z0-9 ._/#:-]*$/.test(trimmed) && trimmed ? trimmed : undefined;
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const events = (payload as { events?: unknown })?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const accepted = (events as ClientEvent[])
    .slice(0, MAX_EVENTS)
    .filter((event) => ALLOWED_OPERATIONS.has(event?.operation));

  /*
   * EVERY DATABASE ROUND TRIP HAPPENS AFTER THE RESPONSE
   * ----------------------------------------------------
   * This handler used to resolve the account and write the rows before
   * answering: two sequential round trips, measured at **720–1,270ms per
   * beacon** against a production build. A beacon is sent on every navigation,
   * so those two connections were held from the five-connection pool at exactly
   * the moment the person's *next* page was trying to read from it.
   *
   * `sendBeacon` never waits for the answer, so nothing about that time was
   * ever useful to the browser — it was pure contention. `after()` runs the
   * work once the response is out, which is what the comment above always
   * claimed and now is true of the server side too.
   */
  /*
   * The console's navigations do not carry a customer account, so do not look
   * for one.
   *
   * Resolving the account is a `users` round trip, and a beacon rides **every**
   * navigation — so this ran once per click, holding a pooled connection at the
   * moment the person's next page was reading through the same pool. On an
   * `/admin/*` route it can only ever return null: operators are resolved
   * through `admin_agents.auth_user_id`, and an operator is usually not a
   * `public.users` row at all (CLAUDE.md §20 — the two lookups are deliberately
   * independent). Paying a round trip for a guaranteed null is the definition of
   * instrumentation that costs more than it reports.
   *
   * Decided from the events' own `route`, which is already sanitised to a path
   * shape below and is a label rather than an authority — the worst a forged
   * value achieves is declining to stamp a user id on its own rows.
   */
  const consoleOnly = accepted.every((event) =>
    (sanitiseRoute(event.route) ?? "").startsWith("/admin"),
  );

  after(async () => {
    // The account, if there is one. From the session; the body has no say.
    let userId: string | null = null;
    if (!consoleOnly) {
      try {
        const account = await getAuthenticatedAccount();
        userId = account?.userId ?? null;
      } catch {
        // An unauthenticated visitor's navigation is still worth timing.
      }
    }

    /*
     * One trace for the whole batch, so it flushes as a single insert.
     *
     * Each event still carries its *own* correlation id — a batch can span two
     * navigations if the first flush did not get out in time, and every event
     * belongs to the navigation it described rather than to this upload. Opening
     * a trace per event would have cost one round trip per event, which is
     * exactly the mistake this endpoint exists to help find.
     */
    await withTrace({ actorType: "user" }, async () => {
      for (const event of accepted) {
        const route = sanitiseRoute(event.route);
        const label = sanitiseLabel(event.label);
        const duration =
          typeof event.durationMs === "number" &&
          Number.isFinite(event.durationMs)
            ? Math.min(Math.max(event.durationMs, 0), MAX_DURATION_MS)
            : undefined;

        recordPipelineEvent({
          pipeline: "navigation",
          layer: "client",
          correlationId: sanitiseCorrelationId(event.correlationId),
          operation: event.operation,
          status:
            event.status === "failed"
              ? "failed"
              : event.status === "started"
                ? "started"
                : "ok",
          message: label
            ? `${event.operation} · ${label}`
            : `Browser reported ${event.operation}`,
          durationMs: duration,
          route: route ?? null,
          userId,
        });
      }
    });
  });

  // 204: the browser has nothing to do with the answer, and `sendBeacon`
  // ignores it entirely.
  return new NextResponse(null, { status: 204 });
}
