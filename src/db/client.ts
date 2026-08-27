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
import { warmConnectionPool } from "./warmup";

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
 *
 * WHY `node:net` IS IMPORTED HERE AND NOT AT THE TOP OF THE FILE
 * --------------------------------------------------------------
 * A top-level `import net from "node:net"` makes this module unloadable on the
 * Edge runtime, and — more to the point — makes it *unbundleable* for it:
 * webpack fails with `UnhandledSchemeError: Reading from "node:net" is not
 * handled` for any entry point whose graph can reach this file, even one that
 * never executes it.
 *
 * `instrumentation.ts` is exactly such an entry point. Next compiles it for
 * every runtime, so a runtime guard around a dynamic import is not enough:
 * webpack still resolves the graph statically and still fails. This is why the
 * previous attempt at a pool warm-up was abandoned as unworkable.
 *
 * Moving the import in here fixes it at the root rather than working around it.
 * The function already returns a Promise — postgres.js's `socket` option
 * expects one — so awaiting the import costs nothing and the module now has no
 * static Node-only dependency for any bundler to trip over.
 */
async function connectOverIpv4(options: {
  host: string[];
  port: number[];
}): Promise<import("node:net").Socket> {
  const net = await import("node:net");

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
     * can avoid. What the pool no longer pays is the handshake for connections
     * two through five: `warmConnectionPool()` opens those in the background
     * when the pool is created, so a page issuing four parallel queries finds
     * them already open (203ms instead of 2,008ms).
     *
     * That warm-up lives on pool creation rather than in `instrumentation.ts`,
     * which was tried twice and does not work: Next compiles that hook for the
     * edge runtime too, and webpack resolves the module graph statically, so
     * even a dynamic import behind a `NEXT_RUNTIME` guard drags `postgres` and
     * `node:net` into the edge bundle and fails the build. See `./warmup`.
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
    /**
     * How long to wait for the Postgres startup handshake.
     *
     * This is a **retry lever**, not a patience setting, and it was lowered
     * from 10s rather than raised. One of the pooler's three A records accepts
     * the TCP connection and then never finishes the handshake (see
     * `./resilience`), so this value is exactly how long a doomed attempt
     * burns before a retry can pick a different endpoint.
     *
     * Measured healthy handshakes from here: 2.3s, 2.5s, 2.7s on two endpoints
     * and 2.5–4.6s on the slowest. 6s clears the worst healthy case with margin,
     * and a false timeout costs only a retry rather than an error.
     *
     * IT IS CHOSEN AGAINST THE RETRY BUDGET, NOT IN ISOLATION
     * -------------------------------------------------------
     * With the 12s budget in `./resilience`, 6s is what makes the worst case
     * exactly two attempts: the first burns 6s, the backoff is ~0.2s, the
     * second starts at 6.2s (inside the budget) and the third is refused
     * because 12.6s is not. So a dead database fails at ~12s, while the
     * intermittent case this exists for — one bad endpoint out of three —
     * recovers at ~8.7s (6s wasted, then a 2.5s handshake elsewhere) instead
     * of failing outright.
     *
     * Raising this back to 10s+ would not fix anything: the broken endpoint
     * does not complete in 20s either. It would only make the failure slower,
     * and would push the second attempt outside the budget so no retry
     * happened at all.
     */
    connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT ?? 6),
    /**
     * TCP keepalive on an idle pooled connection.
     *
     * `idle_timeout: 0` keeps sockets forever, which is what makes navigation
     * fast — and creates the opposite risk: holding a socket a NAT or the
     * pooler has silently dropped, discovered only when a query needs it.
     * Keepalive probes keep the path alive and surface a genuinely dead socket
     * as an error the retry above can handle, rather than as a hang.
     */
    keep_alive: Number(process.env.DATABASE_KEEPALIVE_SECONDS ?? 60),
    /**
     * Behind a transaction-mode pooler each statement may land on a different
     * backend, so a prepared statement created by one is gone by the next.
     * postgres.js prepares by default; that has to be off here. It stays on
     * for a session-mode or direct connection, where it is a real saving.
     *
     * Nothing currently sets a transaction-pooler URL — see `./env` for the
     * measured reason this driver cannot use one — but the detection stays so
     * that pointing `DATABASE_URL` at :6543 is never silently wrong.
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
      /*
       * Maximum session-mode connections held PER SERVER INSTANCE.
       *
       * THIS NUMBER IS A SLICE OF A FIXED PROJECT-WIDE BUDGET, NOT A LOCAL
       * TUNING KNOB
       * --------------------------------------------------------------------
       * `DATABASE_URL` is the *session* pooler, where a client connection
       * reserves a Postgres backend for as long as it is held. Supavisor
       * refuses a sixteenth one for the whole project:
       *
       *   (EMAXCONNSESSION) max clients reached in session mode
       *   - max clients are limited to pool_size: 15
       *
       * That fifteen is shared by every application instance, `npm run db:*`,
       * the TRON scanner and the test suite.
       *
       * WHY THIS WAS LOWERED FROM EIGHT
       * -------------------------------
       * Eight was measured on a single long-running server and is genuinely
       * faster there: Home issues nine independent reads once its account id is
       * known, so a bigger pool turns two waves into one and `warmConnectionPool`
       * pays for the handshakes off the critical path. Three alternating runs
       * against a production build gave Home 1.10–1.49s at max 5 to 0.75–0.83s
       * at max 10.
       *
       * But it is the wrong shape for a platform that answers load by adding
       * instances. At eight-plus-seven-warm, ONE instance holds over half the
       * project's budget the moment it starts, a second cannot warm fully, and
       * a third is refused outright — and being refused surfaces as a failed
       * render, not as a slow one. Three per instance lets four or five
       * instances coexist and still leaves headroom for the scripts.
       *
       * So this is deliberately sized for the worst case rather than the
       * fastest one. `DATABASE_POOL_MAX` raises it for a deployment that really
       * is a single long-running server, and the honest way to buy the speed
       * back everywhere is to raise the project's pool size in the Supabase
       * dashboard first. It moves together with `DATABASE_WARM_CONNECTIONS`;
       * see `./warmup` for why raising one alone is worse than raising neither.
       */
      max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    });

    /*
     * Warm the rest of the pool in the background, exactly once, on the same
     * tick the pool is created.
     *
     * Fire-and-forget: the caller that triggered creation opens its own
     * connection as it always did and waits for nothing extra. What this buys
     * is every *subsequent* concurrent query finding a connection already
     * open — 203ms instead of 2,008ms for a five-query burst. See `./warmup`.
     */
    warmConnectionPool(globalForDb.nanotronDb);
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
