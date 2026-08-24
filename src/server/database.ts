import "server-only";

import { unstable_noStore as noStore } from "next/cache";

import { getDb, isDatabaseConfigured, type Database } from "@/db";
import {
  DEFAULT_RETRY_BUDGET_MS,
  withConnectionRetry,
} from "@/db/resilience";
import { recordPipelineEvent } from "@/server/observability";

/**
 * The seam between the database and the seed data.
 *
 * `src/server/` is the only part of the application that talks to Postgres, and
 * every module in it carries `server-only` so a stray import from a client
 * component fails at build rather than shipping a connection string to a
 * browser.
 *
 * WHY THE FALLBACK EXISTS
 * -----------------------
 * With no `DATABASE_URL`, the prototype runs exactly as it did before the
 * database existed: the services return the mock modules in `@/data`. That is
 * not a convenience — it is what lets the database be introduced without the
 * frontend brief ("frontend only, realistic mock data") stopping being true
 * for anyone who has not provisioned a server yet. Clone, `npm run dev`, and
 * the app works.
 *
 * The fallback is chosen by configuration, never by failure: if `DATABASE_URL`
 * is set and the query fails, the error propagates. Silently serving mock data
 * over a broken connection would hide exactly the problem you need to see.
 */
export async function fromDatabase<T>(
  query: (db: Database) => Promise<T>,
  fallback: () => T | Promise<T>,
): Promise<T> {
  if (!isDatabaseConfigured()) {
    return fallback();
  }

  // Reading live account state opts this render out of static generation. It is
  // called only on the database path, so with no database configured the build
  // still prerenders everything it always did.
  noStore();

  return resilientRead(() => query(getDb()));
}

/**
 * A read with both guards: a bounded retry around transient connection
 * failures, and a deadline around the whole thing.
 *
 * ORDER MATTERS — THE DEADLINE IS OUTSIDE THE RETRY
 * -------------------------------------------------
 * Wrapping each attempt in its own deadline would let three attempts take
 * three deadlines, so the retry would silently triple the worst case a caller
 * was promised. With the deadline outside, the retry budget lives *inside* the
 * time the caller already agreed to wait, and a page fails when it said it
 * would whether it tried once or three times.
 *
 * Reads only. See `./write` — no mutation is routed through here, because a
 * write that failed after reaching the server may have committed.
 */
export function resilientRead<T>(query: () => Promise<T>): Promise<T> {
  return withTimeout(
    withConnectionRetry(query, {
      budgetMs: Math.min(DEFAULT_RETRY_BUDGET_MS, QUERY_TIMEOUT_MS),
      onRetry: ({ attempt, error, delayMs }) => {
        /*
         * Recorded, never swallowed silently.
         *
         * A retry that works is invisible in every user-facing signal — the
         * page simply loads — so without this the pooler could be failing a
         * third of its connection attempts and nothing would say so. This is
         * the line that turns "it feels flaky sometimes" into a number.
         *
         * Best-effort: an instrumentation failure must never turn a recovered
         * read into a broken one.
         */
        try {
          recordPipelineEvent({
            pipeline: "database",
            layer: "database",
            operation: "database.connectRetry",
            // The *attempt* genuinely failed, so it is recorded as failed —
            // and that is deliberate rather than pessimistic. These rows are
            // the only evidence that the pooler is dropping a share of its
            // connection attempts; hiding a recovered failure would hide the
            // infrastructure fault this whole module exists to work around.
            // `willRetry` separates "recovered" from "gave up" when reading.
            status: "failed",
            message: `Transient connection failure; retrying in ${delayMs}ms (attempt ${attempt})`,
            errorMessage:
              error instanceof Error
                ? `${error.name}: ${error.message}`
                : String(error),
            metadata: { attempt, delayMs, willRetry: true },
          });
        } catch {
          // Instrumentation is never allowed to fail the read it describes.
        }
      },
    }),
  );
}

/**
 * The deadline that turns an outage into an error.
 *
 * Without it a database that refuses connections does not fail — it hangs.
 * postgres.js retries a refused connection indefinitely, so the query never
 * settles, the render never finishes, and the request sits there until
 * something further up gives up. That is worse than a 500: it holds a
 * serverless invocation open and tells the operator nothing.
 *
 * Longer than any query this application should ever run, short enough that a
 * broken database surfaces as a failed page rather than a stuck one.
 */
const QUERY_TIMEOUT_MS = Number(process.env.DATABASE_QUERY_TIMEOUT_MS ?? 15_000);

function withTimeout<T>(query: Promise<T>): Promise<T> {
  // If the deadline wins, the query is still in flight and will settle later.
  // Claiming its rejection here keeps that from surfacing as an unhandled
  // rejection and taking the process down with it.
  query.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Database query exceeded ${QUERY_TIMEOUT_MS}ms. The database is ` +
              `configured but is not answering.`,
          ),
        ),
      QUERY_TIMEOUT_MS,
    );
  });

  return Promise.race([query, deadline]).finally(() => clearTimeout(timer));
}

export { isDatabaseConfigured };
export type { Database };
