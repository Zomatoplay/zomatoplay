import net from "node:net";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import {
  requireAdminDatabaseUrl,
  requireDatabaseUrl,
  shouldForceIpv4,
  shouldUseSsl,
  usesTransactionPooler,
} from "./env";
import * as schema from "./schema";

/**
 * The Drizzle client.
 *
 * Deliberately free of `server-only` and of any Next.js import: the migration
 * and seed scripts run this module as plain Node. The boundary that keeps the
 * database out of the browser is `src/server/`, every module of which is
 * `server-only`, and which is the only thing application code imports.
 *
 * The runtime connection is created lazily, on first query. That matters
 * because the services fall back to the seed modules when `DATABASE_URL` is
 * unset — with an eager connection, merely importing a service would fail on a
 * machine that has no database, which is a setup this prototype still supports.
 */

export type Database = ReturnType<typeof createDatabase>;

interface ClientOptions {
  url: string;
  max: number;
}

/**
 * Opens the TCP socket itself, restricted to IPv4.
 *
 * postgres.js takes a `socket` factory and, when given one, expects it to hand
 * back an already-connected socket — so the address family is ours to choose.
 * Everything after this point (TLS, the startup handshake, pooling) is still
 * the driver's.
 *
 * `host` and `port` are copied onto the socket because the driver reads
 * `socket.host` for the TLS server name and only sets it on the path we are
 * replacing. Without them the handshake would go out with no SNI.
 *
 * Used only when `DATABASE_FORCE_IPV4` is set — see `shouldForceIpv4()`.
 */
function connectOverIpv4(options: {
  host: string[];
  port: number[];
}): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const host = options.host[0];
    const port = options.port[0];
    const socket = net.connect({ host, port, family: 4 });
    Object.assign(socket, { host, port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function createDatabase({ url, max }: ClientOptions) {
  const pooled = usesTransactionPooler(url);

  const client = postgres(url, {
    ssl: shouldUseSsl(url) ? "require" : false,
    max,
    /**
     * How long an unused connection is kept.
     *
     * THIS IS THE SINGLE MOST EXPENSIVE NUMBER IN THE APPLICATION.
     *
     * Opening a connection to the Supabase pooler costs **~2,000ms** from a
     * client this far from the region: DNS is 1ms and the TCP connect is one
     * ~200ms round trip, but the Postgres startup handshake — SSLRequest, the
     * TLS handshake, SCRAM authentication, the ready-for-query — is roughly ten
     * more. A query on an established connection costs ~185ms.
     *
     * It used to be 20 seconds, and that is exactly the interval a human
     * spends reading a page before clicking the next thing. Measured: query,
     * wait 25s, query again → 2,236ms. With the connection kept, the same
     * second query costs 187ms. Every navigation after a pause was paying to
     * rebuild a connection that had been thrown away seconds earlier.
     *
     * `0` means "never close it for being idle", which is the right answer for
     * a long-running server: the pool is bounded by `max`, so the cost of
     * keeping them is a handful of sockets. On a platform that freezes idle
     * instances the connections die with the instance anyway, and the pooler
     * reaps its own side.
     *
     * The remaining handshake is the *first* query in a process, which nobody
     * can avoid — a warm-up in `instrumentation.ts` was tried and removed: the
     * hook is compiled for the edge runtime too, where this module's
     * `node:net` import has no scheme, and the contortions needed to keep the
     * bundler happy cost more than the one request they would have saved.
     */
    idle_timeout: Number(process.env.DATABASE_IDLE_TIMEOUT ?? 0),
    /**
     * How long a connection may live before it is replaced.
     *
     * With `idle_timeout: 0` a connection is never closed for being idle, which
     * is what keeps navigation fast. The risk that creates is the opposite one:
     * holding a socket that Supavisor has already reaped on its side, and only
     * discovering it is dead when a query needs it — surfacing as
     * `CONNECT_TIMEOUT` at the worst moment.
     *
     * Rotating on a schedule replaces it *before* that happens, at a moment of
     * our choosing. postgres.js defaults to a random 30–60 minutes; this pins
     * it to 30 so the upper bound is known rather than sampled.
     */
    max_lifetime: Number(process.env.DATABASE_MAX_LIFETIME ?? 60 * 30),
    connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT ?? 10),
    /**
     * Behind a transaction-mode pooler each statement may land on a different
     * backend, so a prepared statement created by one is gone by the next.
     * postgres.js prepares by default; that has to be off here. It stays on
     * for a session-mode or direct connection, where it is a real saving.
     */
    prepare: !pooled,
    ...(shouldForceIpv4() ? { socket: connectOverIpv4 } : {}),
  });

  // Every column is named explicitly in the schema, so no casing strategy is
  // configured here — the table definitions are the single source of truth for
  // what a column is called.
  return drizzle(client, { schema });
}

/**
 * Cached across module reloads.
 *
 * Next's dev server re-evaluates modules on every edit. Without this the
 * connection pool would be recreated on each save and the old sockets left to
 * time out.
 */
const globalForDb = globalThis as unknown as {
  nanotronDb?: Database;
};

/**
 * The application's connection: pooled, shared, never closed by callers.
 */
export function getDb(): Database {
  if (!globalForDb.nanotronDb) {
    globalForDb.nanotronDb = createDatabase({
      url: requireDatabaseUrl(),
      // Per instance, not per database: a serverless deployment runs many
      // instances, each with its own pool, and Supabase's session pooler has a
      // finite number of server connections to share between them. Small and
      // reused beats large and contended.
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    });
  }
  return globalForDb.nanotronDb;
}

/**
 * A connection for migrations, seeding and other admin work.
 *
 * Separate from the runtime pool and never cached: these are one-shot scripts
 * that should hold a single session-mode connection and hand it back. The
 * caller closes it — see `closeAdminDb`.
 */
export function createAdminDb(): Database {
  return createDatabase({ url: requireAdminDatabaseUrl(), max: 1 });
}

async function end(db: Database): Promise<void> {
  await (db.$client as unknown as { end: () => Promise<void> }).end();
}

/** Closes an admin connection created above. */
export async function closeAdminDb(db: Database): Promise<void> {
  await end(db);
}

/**
 * Closes the runtime pool. Only the CLI scripts need this — a long-running
 * server keeps its connections for the life of the process.
 */
export async function closeDb(): Promise<void> {
  const db = globalForDb.nanotronDb;
  if (!db) return;
  globalForDb.nanotronDb = undefined;
  await end(db);
}

/**
 * A handle inside a transaction.
 *
 * Every write in this application takes one of these rather than a `Database`,
 * which is how the type system enforces that money never moves outside a
 * transaction: a repository that mutates a balance cannot be called with the
 * ambient connection by accident.
 */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Either handle, for reads that are happy in or out of a transaction. */
export type Queryable = Database | Tx;
