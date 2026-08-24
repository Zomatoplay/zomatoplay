import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration — migration generation and the studio only.
 *
 * The running application never reads this file; it connects through
 * `src/db/client.ts`. `.env.local` is loaded explicitly because Kit runs
 * outside Next.js and so does not inherit Next's environment loading.
 *
 * Kit gets the *admin* connection (`DIRECT_DATABASE_URL`, the session pooler on
 * Supabase), never the runtime one: introspection, `push` and Studio all hold a
 * session open, which a transaction-mode pooler will not do.
 *
 * `generate` works without a database. `migrate`, `push` and `studio` need a
 * reachable one.
 */

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Empty only when generating migrations, which needs no connection.
    url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});
