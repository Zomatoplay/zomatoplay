-- Hand-written, and deliberately so. Two things drizzle-kit cannot generate:
-- a data backfill, and the repair of an index its own snapshot already
-- believes exists.
--
-- 1. BACKFILL THE ASSIGNMENT HISTORY
-- ----------------------------------
-- `deposit_address_assignments` (0014) is what makes attribution a lookup by
-- time rather than by current holder. Every address already assigned has a
-- history that starts now as far as this table is concerned, so an open row is
-- written for each one — otherwise the first transfer to an existing
-- assignment would match no interval and land in the operator queue, which
-- would be a regression against a working production deposit flow.
--
-- `assigned_at` is copied from the pool row, so the interval genuinely covers
-- the period the person has held the address rather than starting at deploy
-- time. `ON CONFLICT DO NOTHING` against the partial unique index makes this
-- safe to re-run.
INSERT INTO "deposit_address_assignments"
  ("id", "address_id", "address", "chain", "network", "asset", "user_id",
   "assigned_at", "released_at", "release_reason", "created_at")
SELECT
  'dpx_' || substr(md5(random()::text || "id"), 1, 16),
  "id",
  "address",
  "chain",
  "network",
  "asset",
  "user_id",
  coalesce("assigned_at", "created_at"),
  NULL,
  NULL,
  now()
FROM "deposit_addresses"
WHERE "user_id" IS NOT NULL
  AND "status" = 'assigned'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- `last_user_id` is what lets a returning customer be handed back the address
-- they already had. For a row that is currently assigned it is the holder; for
-- one already released it is unrecoverable and stays null.
UPDATE "deposit_addresses"
SET "last_user_id" = "user_id"
WHERE "user_id" IS NOT NULL AND "last_user_id" IS NULL;
--> statement-breakpoint
-- 2. ASSERT A UNIQUE INDEX THAT THE LOOKUP DEPENDS ON
-- ---------------------------------------------------
-- `drizzle/0003_admin_auth_link.sql` creates `admin_agents_auth_user_id_key`,
-- and it is present on the production database (verified 2026-09-14). This
-- statement is therefore a no-op there, and it is here for environments where
-- 0003 was applied against a database that had already diverged.
--
-- It is worth asserting rather than assuming, because `loadOperator` selects an
-- agent joined to its permissions by `auth_user_id`, takes `rows[0]` as the
-- agent, and merges the permission map over *every* returned row. Two agent
-- rows sharing one `auth_user_id` would resolve to an arbitrary one of the two
-- identities holding the union of both permission sets. The unique index is
-- what makes that unrepresentable, so the schema should state it and a
-- migration should be able to restore it.
CREATE UNIQUE INDEX IF NOT EXISTS "admin_agents_auth_user_id_key"
  ON "admin_agents" USING btree ("auth_user_id");
