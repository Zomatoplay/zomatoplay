/**
 * Database entry point for scripts and the server layer.
 *
 * Application code should not import this directly — it goes through
 * `@/server/services/*`, which owns the fallback to the seed data in `@/data`
 * and carries the `server-only` marker.
 */

export {
  closeAdminDb,
  closeDb,
  createAdminDb,
  getDb,
  type Database,
  type Queryable,
  type Tx,
} from "./client";
export {
  DATABASE_URL_VAR,
  DIRECT_DATABASE_URL_VAR,
  getAdminDatabaseUrl,
  getDatabaseUrl,
  isDatabaseConfigured,
  requireAdminDatabaseUrl,
  requireDatabaseUrl,
  usesTransactionPooler,
} from "./env";
export * as schema from "./schema";
