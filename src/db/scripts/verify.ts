import { readFileSync } from "node:fs";

import { config as loadEnv } from "dotenv";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import postgres from "postgres";

import { requireAdminDatabaseUrl, shouldUseSsl } from "../env";
import * as schema from "../schema";

/**
 * READ-ONLY database verification: what is this database, how far is it
 * migrated, will the pending migrations apply, and what does it hold — as
 * aggregate counts only.
 *
 *   npm run db:verify              before a migration, and again after
 *
 * Written for the RDS move, where the target has to be identified before
 * anything is changed and the before/after figures compared. Every statement
 * runs inside `BEGIN READ ONLY`, so this cannot write even by mistake. It
 * prints no connection string, host name, password, name, email or phone
 * number: the target is described by its kind and region, and people by
 * counts.
 *
 * Exit code 1 means "do not migrate yet" — a missing table the code needs, or
 * data a pending migration's constraint would reject.
 */

const EXPECTED_TABLES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table as PgTable))
  .sort();

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function describeTarget(url: string): string {
  let host = "";
  let database = "";
  try {
    const parsed = new URL(url);
    host = parsed.hostname;
    database = parsed.pathname.replace(/^\//, "");
  } catch {
    return "unparseable URL (a '#', '@' or '/' in the password must be percent-encoded)";
  }
  const rds = /\.([a-z]{2}-[a-z]+-\d)\.rds\.amazonaws\.com$/.exec(host);
  const kind = rds
    ? `AWS RDS (${rds[1]})`
    : /supabase\.(com|co)$/.test(host)
      ? "Supabase"
      : /^(localhost|127\.0\.0\.1|::1)$/.test(host)
        ? "local PostgreSQL"
        : "other PostgreSQL host";
  return `${kind}, database "${database}"`;
}

async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  const url = requireAdminDatabaseUrl();
  console.log("Target              :", describeTarget(url));

  const sql = postgres(url, {
    ssl: shouldUseSsl(url) ? "require" : false,
    max: 1,
    connect_timeout: 15,
    onnotice: () => {},
  });

  let blocking = false;
  const fail = (line: string) => {
    blocking = true;
    console.log(`  ✗ ${line}`);
  };

  try {
    await sql`begin read only`;

    const [server] = await sql<{ version: string; recovery: boolean }[]>`
      select current_setting('server_version') as version, pg_is_in_recovery() as recovery`;
    console.log("Server              :", `PostgreSQL ${server.version}${server.recovery ? " (read replica!)" : ""}`);
    if (Number.parseInt(server.version, 10) < 14) fail("PostgreSQL 14 or newer is required.");

    /* -------------------------------------------------------- migrations -- */

    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
      entries: JournalEntry[];
    };
    const [{ exists }] = await sql<{ exists: boolean }[]>`
      select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
    let lastApplied = 0;
    let appliedCount = 0;
    if (exists) {
      const [row] = await sql<{ n: number; last: string | null }[]>`
        select count(*)::int as n, max(created_at)::text as last from drizzle.__drizzle_migrations`;
      appliedCount = row.n;
      lastApplied = row.last ? Number(row.last) : 0;
    }
    // Drizzle applies every journal entry newer than the last one it recorded.
    const pending = journal.entries.filter((entry) => entry.when > lastApplied);
    console.log(
      "Migrations          :",
      `${appliedCount} recorded, ${journal.entries.length} in this checkout, ${pending.length} pending`,
    );
    if (pending.length > 0) {
      console.log("  pending           :", pending.map((entry) => entry.tag).join(", "));
    }

    /* ------------------------------------------------------------ tables -- */

    const present = new Set(
      (
        await sql<{ table_name: string }[]>`
          select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`
      ).map((row) => row.table_name),
    );
    const missing = EXPECTED_TABLES.filter((table) => !present.has(table));
    const extra = [...present].filter((table) => !EXPECTED_TABLES.includes(table)).sort();
    console.log(
      "Tables              :",
      `${EXPECTED_TABLES.length - missing.length}/${EXPECTED_TABLES.length} expected present` +
        (extra.length ? `, ${extra.length} not in the schema (${extra.join(", ")})` : ""),
    );
    if (missing.length > 0) {
      console.log("  missing           :", missing.join(", "));
      if (pending.length === 0) fail("tables are missing but no migration is pending.");
    }

    /* --------------------------------- what the current code relies on -- */

    const columns = await sql<{ t: string; c: string }[]>`
      select table_name as t, column_name as c from information_schema.columns
      where table_schema = 'public'
        and (table_name, column_name) in (
          ('users','session_epoch'), ('users','firebase_uid'), ('users','phone_e164'),
          ('deposit_requests','cancelled_at'), ('deposit_requests','cancellation_reason'),
          ('kyc_documents','storage_backend'))`;
    const have = new Set(columns.map((row) => `${row.t}.${row.c}`));
    const needed = [
      "users.firebase_uid",
      "users.phone_e164",
      "users.session_epoch",
      "deposit_requests.cancelled_at",
      "deposit_requests.cancellation_reason",
      "kyc_documents.storage_backend",
    ];
    const absent = needed.filter((name) => !have.has(name));
    console.log(
      "Columns the code reads:",
      absent.length === 0 ? "all present" : `missing ${absent.join(", ")}${pending.length ? " (a pending migration adds them)" : ""}`,
    );
    if (absent.length > 0 && pending.length === 0) fail("columns missing with nothing pending.");

    const [{ cancelled }] = await sql<{ cancelled: boolean }[]>`
      select exists (
        select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
        where t.typname = 'deposit_request_status' and e.enumlabel = 'cancelled') as cancelled`;
    const [{ oneAwaiting }] = await sql<{ oneAwaiting: boolean }[]>`
      select to_regclass('public.deposit_requests_one_awaiting_per_user_key') is not null as "oneAwaiting"`;
    console.log(
      "Deposit lifecycle   :",
      `'cancelled' status ${cancelled ? "present" : "absent"}, one-awaiting index ${oneAwaiting ? "present" : "absent"}`,
    );

    /*
     * Will 0020 apply? It creates a UNIQUE index over awaiting_payment requests
     * per user. Existing duplicates would make the migration fail half-way
     * through a deploy, so they are counted here, before anything runs.
     */
    if (present.has("deposit_requests") && !oneAwaiting) {
      const [{ n }] = await sql<{ n: number }[]>`
        select count(*)::int as n from (
          select user_id from deposit_requests where status = 'awaiting_payment'
          group by user_id having count(*) > 1) d`;
      if (n > 0) {
        fail(
          `${n} account(s) hold more than one awaiting_payment request; migration 0020's unique index would fail. ` +
            "Expire the older ones (status 'expired') before migrating.",
        );
      } else {
        console.log("  0020 pre-check    : no account holds two awaiting requests — the index will build");
      }
    }

    /* -------------------------------------------------- aggregate counts -- */

    const count = async (table: string, where = "true") => {
      if (!present.has(table)) return "absent";
      const [row] = await sql.unsafe<{ n: number }[]>(
        `select count(*)::int as n from public."${table}" where ${where}`,
      );
      return String(row.n);
    };

    console.log("Counts (aggregate only):");
    const rows: [string, string][] = [
      ["users", await count("users")],
      ["  with a verified phone", present.has("users") && have.has("users.phone_e164") ? await count("users", "phone_e164 is not null") : "n/a"],
      ["  with an email sign-in link", await count("users", "auth_user_id is not null")],
      ["  seed fixtures (@example.com)", await count("users", "email like '%@example.com'")],
      ["  test leftovers (@example.invalid)", await count("users", "email like '%@example.invalid'")],
      ["wallet_balances", await count("wallet_balances")],
      ["transactions (ledger)", await count("transactions")],
      ["deposits", await count("deposits")],
      ["deposit_requests", await count("deposit_requests")],
      ["investments", await count("investments")],
      ["withdrawals", await count("withdrawals")],
      ["kyc_submissions", await count("kyc_submissions")],
      ["kyc_documents", await count("kyc_documents")],
      ["referrals", await count("referrals")],
      ["commission_entries", await count("commission_entries")],
      ["admin_agents", await count("admin_agents")],
      ["  active and sign-in-linked", await count("admin_agents", "status = 'active' and auth_user_id is not null")],
      ["platform_settings", await count("platform_settings")],
      ["audit_logs", await count("audit_logs")],
    ];
    for (const [label, value] of rows) console.log(`  ${label.padEnd(36)} ${value}`);

    if (present.has("wallet_balances")) {
      const [sum] = await sql<{ available: string | null }[]>`
        select coalesce(sum(available), 0)::text as available from wallet_balances`;
      console.log(`  ${"Σ available balance (USDT)".padEnd(36)} ${sum.available}`);
    }

    await sql`rollback`;
  } finally {
    await sql.end({ timeout: 5 });
  }

  if (blocking) {
    console.log("\nResult: DO NOT MIGRATE until the ✗ items above are resolved.");
    process.exitCode = 1;
  } else {
    console.log("\nResult: read-only checks passed. Nothing was written.");
  }
}

main().catch((error) => {
  // postgres.js errors do not carry the URL; nothing here adds it.
  const code = (error as { code?: string })?.code;
  console.error(
    "Verification failed:",
    code ? `${code} ` : "",
    error instanceof Error ? error.message : error,
  );
  if (code === "CONNECT_TIMEOUT" || code === "ETIMEDOUT" || code === "ECONNREFUSED") {
    console.error(
      "The database did not answer. An RDS instance without public access is reachable only from inside its VPC (the EC2 host) or through an SSH tunnel.",
    );
  }
  process.exitCode = 1;
});
