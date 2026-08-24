import "server-only";

import { unstable_noStore as noStore } from "next/cache";

import { getDb, isDatabaseConfigured, type Database } from "@/db";

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

  return withTimeout(query(getDb()));
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
