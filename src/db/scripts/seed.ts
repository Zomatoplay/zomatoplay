import { config as loadEnv } from "dotenv";

import { closeAdminDb, createAdminDb } from "../client";
import { seedDatabase } from "../seed";

/**
 * Loads the development seed data.
 *
 * Run with `npm run db:seed`, after `npm run db:migrate`. Uses the admin
 * connection (`DIRECT_DATABASE_URL`) rather than the runtime pool: this is a
 * long batch of inserts, and it wants one session-mode connection of its own.
 *
 * It clears every table first so it can be re-run, which makes it destructive
 * by nature — hence the production guard. Nothing about it is safe to point at
 * real user data, and it should never be wired into a deploy step.
 */
async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DESTRUCTIVE_SEED !== "true") {
    throw new Error(
      "Refusing to seed with NODE_ENV=production. This deletes every row in " +
        "every table. Set ALLOW_DESTRUCTIVE_SEED=true if that is genuinely what " +
        "you want.",
    );
  }

  console.log("Seeding from the mock modules in src/data …");
  const db = createAdminDb();
  let report;
  try {
    report = await seedDatabase(db);
  } finally {
    await closeAdminDb(db);
  }

  const width = Math.max(...Object.keys(report).map((key) => key.length));
  for (const [table, count] of Object.entries(report)) {
    console.log(`  ${table.padEnd(width)}  ${String(count).padStart(5)}`);
  }
  const total = Object.values(report).reduce((sum, count) => sum + count, 0);
  console.log(`Done. ${total} rows across ${Object.keys(report).length} tables.`);
}

main().catch((error) => {
  console.error("Seed failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
