import { config as loadEnv } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { requireAdminDatabaseUrl, shouldUseSsl } from "../env";

/**
 * Applies pending migrations from `drizzle/`.
 *
 * Run with `npm run db:migrate`. Uses `DIRECT_DATABASE_URL` — the session
 * pooler on Supabase — and its own single connection: a migration runs once,
 * takes an advisory lock and issues DDL, none of which survives a
 * transaction-mode pooler handing each statement to a different backend.
 */
async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  const url = requireAdminDatabaseUrl();
  const client = postgres(url, {
    ssl: shouldUseSsl(url) ? "require" : false,
    max: 1,
  });

  try {
    console.log("Applying migrations from ./drizzle …");
    await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  // The connection string carries a password, so only the message is printed —
  // postgres.js does not put the URL in its errors, and nothing here adds it.
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
