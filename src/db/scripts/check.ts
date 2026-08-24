import { config as loadEnv } from "dotenv";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import { closeAdminDb, closeDb, createAdminDb, getDb } from "../client";
import {
  getAdminDatabaseUrl,
  isDatabaseConfigured,
  usesTransactionPooler,
} from "../env";
import * as schema from "../schema";
import type { Database } from "../client";

/**
 * Connectivity and schema check.
 *
 * Run with `npm run db:check`. It exists because the failure modes are
 * otherwise indistinguishable from the application's own fallback — with no
 * `DATABASE_URL` the app quietly runs on the seed modules in `@/data`, which
 * looks identical to a database that is simply empty.
 *
 * Both connections are exercised, because they are different endpoints with
 * different modes and either can be the broken one.
 */

const EXPECTED_TABLES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table as PgTable))
  .sort();

async function scalar<T>(db: Database, query: ReturnType<typeof sql>): Promise<T> {
  const [row] = await db.execute<Record<string, T>>(query);
  return Object.values(row)[0];
}

async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  if (!isDatabaseConfigured()) {
    console.log(
      "DATABASE_URL is not set. The application will run on the seed data in " +
        "src/data. Copy .env.example to .env.local to connect a database.",
    );
    return;
  }

  /* ------------------------------------------------------------- runtime -- */

  const runtime = getDb();
  const version = await scalar<string>(runtime, sql`select version()`);
  console.log("Runtime connection  : ok");
  console.log("  server            :", version.split(" ").slice(0, 2).join(" "));
  console.log(
    "  mode              :",
    usesTransactionPooler(process.env.DATABASE_URL ?? "")
      ? "transaction pooler (prepared statements off)"
      : "session or direct (prepared statements on)",
  );

  /* --------------------------------------------------------------- admin -- */

  const adminUrl = getAdminDatabaseUrl();
  const separate = adminUrl !== process.env.DATABASE_URL;
  const admin = createAdminDb();
  try {
    await scalar(admin, sql`select 1`);
    console.log(
      "Admin connection    : ok" + (separate ? "" : "  (same URL as runtime)"),
    );

    /* ------------------------------------------------------------ schema -- */

    const present = await admin.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name
    `);
    const names = new Set(present.map((row) => row.table_name));
    const missing = EXPECTED_TABLES.filter((table) => !names.has(table));

    console.log(
      `Tables              : ${names.size} present, ${EXPECTED_TABLES.length} expected`,
    );
    if (missing.length > 0) {
      console.log("  missing           :", missing.join(", "));
      console.log("  → run `npm run db:migrate`");
      process.exitCode = 1;
      return;
    }

    // Scoped to `public`: a Supabase database also carries the enums and
    // constraints of its own auth, storage and realtime schemas, and counting
    // those would report a healthy number for an empty application schema.
    const enums = await scalar<string>(
      admin,
      sql`select count(*)::text from pg_type t
          join pg_namespace n on n.oid = t.typnamespace
          where t.typtype = 'e' and n.nspname = 'public'`,
    );
    const fks = await scalar<string>(
      admin,
      sql`select count(*)::text from pg_constraint c
          join pg_namespace n on n.oid = c.connamespace
          where c.contype = 'f' and n.nspname = 'public'`,
    );
    const indexes = await scalar<string>(
      admin,
      sql`select count(*)::text from pg_indexes where schemaname = 'public'`,
    );
    console.log(`Enums               : ${enums}`);
    console.log(`Foreign keys        : ${fks}`);
    console.log(`Indexes             : ${indexes}`);

    /* --------------------------------------------------------------- data -- */

    const users = Number(
      await scalar<string>(admin, sql`select count(*)::text from users`),
    );
    console.log(
      `Users               : ${users}` +
        (users === 0 ? "  → run `npm run db:seed`" : ""),
    );
  } finally {
    await closeAdminDb(admin);
    await closeDb();
  }
}

main().catch((error) => {
  console.error("Check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
