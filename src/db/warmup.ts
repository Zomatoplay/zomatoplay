import type { Database } from "./client";

/**
 * Opening the pool's connections *before* a user waits on them.
 *
 * THE NUMBER THIS EXISTS FOR
 * --------------------------
 * Measured against the configured Supabase project, session pooler,
 * ap-northeast-2, from India:
 *
 *   five concurrent queries on a cold pool   →  2,008 ms
 *   the same five on a warm pool             →    203 ms
 *
 * Ten to one, and almost none of it is the queries: the Postgres startup
 * handshake (SSLRequest, TLS, SCRAM, ready-for-query) is roughly ten round
 * trips while a query is one. A page that needs four connections pays that
 * four times over, concurrently, and that is most of the "the first navigation
 * takes several seconds" complaint.
 *
 * The handshake cannot be avoided. What is avoidable is *who waits for it*.
 *
 * WHY THIS IS TRIGGERED FROM `getDb()` AND NOT FROM `instrumentation.ts`
 * ---------------------------------------------------------------------
 * `instrumentation.ts` is the obvious home for it and does not work. Next
 * compiles that file for **every** runtime including the Edge one, and webpack
 * resolves the module graph statically — so even a dynamic `import()` behind a
 * `NEXT_RUNTIME === "nodejs"` guard still drags `postgres` and its `node:net`
 * dependency into the edge bundle, which fails the build with
 * `UnhandledSchemeError`. That is what defeated the earlier attempt recorded in
 * CLAUDE.md, and it defeats the tidied-up version too — verified, not assumed.
 *
 * Hanging the warm-up off pool creation instead sidesteps the problem entirely:
 * this module is only ever reached from code that already runs on Node, so no
 * bundler is ever asked to compile it for the edge. The pool warms while the
 * first request is still resolving its session, which costs that request
 * nothing and leaves every later one warm.
 */

/**
 * How many connections to open ahead of time.
 *
 * Four, against a default pool of five: the widest user page issues one account
 * query and then four slice queries. Deliberately not the whole pool, so the
 * warm-up can never be the thing that exhausts it.
 *
 * Raising the pool above five was measured and rejected — `max: 12` made the
 * cold burst *worse* (3,270ms vs 2,008ms) with no warm improvement, because
 * more connections simply means more simultaneous handshakes.
 */
const WARM_CONNECTIONS = Number(process.env.DATABASE_WARM_CONNECTIONS ?? 4);

/** Off by default nowhere — set `DATABASE_WARMUP=false` to skip it entirely. */
function isEnabled(): boolean {
  return process.env.DATABASE_WARMUP !== "false" && WARM_CONNECTIONS > 0;
}

/**
 * Opens `WARM_CONNECTIONS` connections in the background. Never awaited.
 *
 * The queries are issued **concurrently and each sleeps briefly**, which is the
 * whole trick: postgres.js gives a new query to an idle connection whenever it
 * has one, so N *sequential* queries would warm exactly one connection. Only
 * overlapping work forces the pool to actually open N of them.
 *
 * `pg_sleep(0.05)` is long enough to guarantee that overlap and short enough to
 * be irrelevant to anything else.
 *
 * Every failure is swallowed. A cold pool is slow, not broken, and whatever is
 * actually wrong will be reported properly by the first real query — with its
 * deadline, its retry and its error category. This must never pre-empt that,
 * and must never keep a server from starting.
 */
export function warmConnectionPool(db: Database): void {
  if (!isEnabled()) return;

  void (async () => {
    try {
      await Promise.all(
        Array.from({ length: WARM_CONNECTIONS }, () =>
          db.execute("select pg_sleep(0.05)"),
        ),
      );
    } catch {
      // Deliberately silent — see above.
    }
  })();
}
