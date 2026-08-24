/**
 * Database configuration.
 *
 * Connection strings are read from the environment and never from source.
 * They belong in `.env.local` (git-ignored) locally and in the platform's
 * secret store in a deployment — see `.env.example` for the shape.
 *
 * Nothing here logs, returns or embeds a URL in an error message: they carry
 * passwords.
 *
 * TWO URLS, ON PURPOSE
 * --------------------
 * The application and the migration scripts want different things from the
 * connection, so they get different ones:
 *
 * - `DATABASE_URL` — the runtime, with a small pool shared by all renders.
 * - `DIRECT_DATABASE_URL` — migrations, seeding and Studio: a separate,
 *   single, short-lived connection. DDL and the advisory lock a migration takes
 *   both want a session to themselves. Optional; falls back to `DATABASE_URL`.
 *
 * WHICH SUPABASE ENDPOINT
 * -----------------------
 * Both point at the *session* pooler (port 5432 on `pooler.supabase.com`), and
 * that is a measured choice rather than the obvious one:
 *
 * - The true direct endpoint (`db.<ref>.supabase.co`) publishes AAAA records
 *   only. Vercel's serverless runtime has no IPv6 egress, so it is unusable
 *   there. The pooler is IPv4.
 * - The *transaction* pooler (port 6543) is the usual recommendation for
 *   serverless, and it is what this was built on first. It had to be abandoned:
 *   postgres.js pipelines queries onto a connection, and past roughly two
 *   queued queries the transaction pooler stops answering — reproduced with the
 *   stock driver and no local patches, at every pool size. A page that issues
 *   six queries in parallel hangs. Session mode on the same host handled twenty
 *   queued queries on a single connection without complaint.
 *
 * Transaction-mode support is kept below so switching back is one environment
 * change if that interaction is ever fixed.
 */

export const DATABASE_URL_VAR = "DATABASE_URL";
export const DIRECT_DATABASE_URL_VAR = "DIRECT_DATABASE_URL";

function read(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/** The runtime connection string, or `undefined` when there is none. */
export function getDatabaseUrl(): string | undefined {
  return read(DATABASE_URL_VAR);
}

/**
 * The connection string for migrations, seeding and other admin work.
 *
 * Falls back to the runtime URL so a plain single-URL setup (a local Postgres,
 * say) needs no second variable.
 */
export function getAdminDatabaseUrl(): string | undefined {
  return read(DIRECT_DATABASE_URL_VAR) ?? getDatabaseUrl();
}

/**
 * Whether a database is configured at all.
 *
 * This is the switch the service layer reads: with no `DATABASE_URL` the
 * services fall back to the seed modules in `@/data`, so the prototype runs
 * exactly as it did before the database existed. It is checked per call rather
 * than cached at module load so a `.env.local` edit takes effect on restart
 * without any other bookkeeping.
 */
export function isDatabaseConfigured(): boolean {
  return getDatabaseUrl() !== undefined;
}

function require_(url: string | undefined, name: string): string {
  if (!url) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env.local and set a PostgreSQL ` +
        `connection string, or leave it unset to run on the seed data in src/data.`,
    );
  }
  return url;
}

/** The runtime connection string, or a clear failure. */
export function requireDatabaseUrl(): string {
  return require_(getDatabaseUrl(), DATABASE_URL_VAR);
}

/** The admin connection string, or a clear failure. */
export function requireAdminDatabaseUrl(): string {
  return require_(
    getAdminDatabaseUrl(),
    `${DIRECT_DATABASE_URL_VAR} (or ${DATABASE_URL_VAR})`,
  );
}

/**
 * Whether a URL points at a connection pooler running in transaction mode.
 *
 * Detected rather than configured, because getting it wrong is silent until it
 * is not: postgres.js prepares statements by default, pgbouncer in transaction
 * mode gives each statement a different backend, and the result is an
 * intermittent "prepared statement does not exist" under concurrency — the
 * worst kind of bug to meet in production. Supabase's transaction pooler is
 * port 6543; `pgbouncer=true` is the marker other providers use.
 *
 * Turning prepared statements off is necessary but, on Supabase, not
 * sufficient — see the note above on why the runtime uses session mode.
 */
export function usesTransactionPooler(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.port === "6543" || parsed.searchParams.get("pgbouncer") === "true";
  } catch {
    return false;
  }
}

/**
 * Whether to open connections over IPv4 only.
 *
 * Off by default; a workaround for one specific environment failure. Some
 * resolvers (a misconfigured `/etc/resolv.conf`, a DNS server that drops AAAA
 * queries) stall for seconds on the IPv6 lookup before falling back to IPv4.
 * `getaddrinfo` pays that stall on every new connection, which turns a page
 * that opens eight of them into a timeout.
 *
 * Supabase's pooler publishes no AAAA record at all, so restricting the lookup
 * to IPv4 loses nothing where it is enabled. It stays opt-in because the stall
 * is a property of the machine, not of the application: a normal host — and
 * Vercel — resolves both families in milliseconds and needs none of this.
 */
export function shouldForceIpv4(): boolean {
  return process.env.DATABASE_FORCE_IPV4 === "true";
}

/**
 * Whether to run queries over TLS. Managed providers (Supabase, Neon, RDS)
 * require it; a local server usually has it off.
 */
export function shouldUseSsl(url = getDatabaseUrl() ?? ""): boolean {
  const explicit = process.env.DATABASE_SSL;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return /[?&]sslmode=(require|verify-ca|verify-full)/.test(url);
}
