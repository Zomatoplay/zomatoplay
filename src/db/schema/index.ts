/**
 * The database schema.
 *
 * Grouped by aggregate rather than by application: the two frontends are
 * isolated from each other (CLAUDE.md §0, §15.1) but they describe one
 * platform, and a user's balance is the same row whichever screen reads it.
 *
 * Nothing in here imports from `@/components`, `@/lib` or Next.js — the schema
 * is consumed by the migration and seed scripts as plain Node modules as well
 * as by the server layer.
 */

export * from "./columns";
export * from "./enums";
export * from "./users";
export * from "./plans";
export * from "./investments";
export * from "./ledger";
export * from "./chain";
export * from "./kyc";
export * from "./referrals";
export * from "./engagement";
export * from "./admin";
export * from "./observability";
export * from "./relations";
