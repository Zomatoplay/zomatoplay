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
     * IT WAS `0`, AND THAT IS WHAT CAUSED `EMAXCONNSESSION`
     * ------------------------------------------------------
     * `0` means "never close it for being idle". On a single long-running
     * server that is right, and it is what the latency note above was measured
     * on. It is wrong here, because `DATABASE_URL` is the **session** pooler:
     * a client connection reserves a Postgres backend for as long as it is
     * held, and Supavisor refuses a sixteenth for the whole project.
     *
     * So `0` did not mean "keep a connection warm". It meant **every process
     * that ever ran a query permanently claimed up to `max` of a fifteen-slot
     * project-wide budget** — a `next start` on a laptop, each Vercel instance,
     * a test run — and gave them back only at `max_lifetime` (30 minutes) or
     * when the process died. Observed directly: fifteen session backends held,
     * fourteen of them idle for nine minutes, with a single idle dev server the
     * only thing running. The next request from anywhere got:
     *
     *   (EMAXCONNSESSION) max clients reached in session mode
     *   - max clients are limited to pool_size: 15
     *
     * Reproduced deliberately, and re-verified by counting the open sockets.
     * At `0`, three `next start` instances held all fifteen and were still
     * holding them 55s after their last query, so a fourth consumer — another
     * instance, `npm run db:*`, the scanner, a cron hit — was refused
     * indefinitely. At 30 the same three drained to zero within 30s and that
     * fourth consumer connected in 2.8s. It happens on localhost and on Vercel
     * for the same reason, and it happens at *zero* traffic, which is what
     * makes it look like a configuration fault rather than a load problem.
     *
     * A non-zero timeout makes the budget **shared over time** rather than
     * permanently partitioned: an instance that stops querying hands its
     * connections back within the window, so a second instance can start. The
     * cost is the ~2s handshake for the first query after a genuinely idle
     * period, which is the trade the note above priced — and it is the correct
     * trade for a serverless deployment, where instances are idle far more
     * often than they are busy.
     *
     * Thirty seconds: longer than a person's click-to-click interval, so
     * ordinary navigation still finds a warm connection, and short enough that
     * an abandoned instance is not holding a third of the project's budget a
     * minute later. `DATABASE_IDLE_TIMEOUT` overrides it; `0` restores the old
     * behaviour and should only be used on a deployment that really is one
     * long-running server with the pool to itself.
     */
    idle_timeout: Number(process.env.DATABASE_IDLE_TIMEOUT ?? 30),
    /**
     * How long a connection may live before it is replaced.
     *
     * A connection released for being idle is gone; one that is *reused* keeps
     * living, and the risk there is the opposite one: holding a socket that
     * Supavisor has already reaped on its side, and only discovering it is dead
     * when a query needs it — surfacing as `CONNECT_TIMEOUT` at the worst
     * moment.
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
     * A connection reused steadily is never closed for being idle, and that
     * creates the opposite risk: holding a socket a NAT or the pooler has
     * silently dropped, discovered only when a query needs it.
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
       * EIGHT WAS TOO GREEDY, THREE WAS TOO TIGHT, FIVE IS THE ANSWER
       * -------------------------------------------------------------
       * Eight was measured on a single long-running server and is genuinely
       * faster there: Home issues nine independent reads once its account id is
       * known, so a bigger pool turns two waves into one and `warmConnectionPool`
       * pays for the handshakes off the critical path. But at eight-plus-seven-
       * warm ONE instance holds over half the project's budget the moment it
       * starts, a second cannot warm fully, and a third is refused outright —
       * and being refused is `EMAXCONNSESSION`, a failed render rather than a
       * slow one.
       *
       * Three fixed that and overcorrected. Measured against a production
       * build with a real session, eighteen concurrent authenticated requests:
       *
       *   max 3, warm 2  →  wall 14,291ms, p50 8,518ms   (max 14,277ms, one
       *                     round trip short of the 15s read deadline)
       *   max 5, warm 3  →  wall  9,348ms / 8,360ms, p50 6,055 / 5,411ms
       *
       * Serially it is no worse and mostly better: Home 1,834 → 1,192ms median,
       * Plans 1,171 → 754ms, everything else inside noise.
       *
       * Five is the arithmetic that fits. The project ceiling is fifteen
       * session-mode clients shared by every instance, `npm run db:*`, the TRON
       * scanner and the test suite; five per instance lets two instances run
       * with five to spare for the scripts, which is the shape this deployment
       * actually has. It is NOT a number to raise per-instance on a platform
       * that answers load by adding instances — the honest way to buy more is
       * to raise the project's pool size in the Supabase dashboard first, or to
       * make the driver migration in `./env`.
       *
       * `DATABASE_POOL_MAX` overrides it for a deployment that really is a
       * single long-running server. It moves together with
       * `DATABASE_WARM_CONNECTIONS`; see `./warmup` for why raising one alone
       * is worse than raising neither.
       */
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
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
