CREATE TABLE "plan_rate_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"min_amount_usdt" numeric(20, 8) NOT NULL,
	"max_amount_usdt" numeric(20, 8),
	"rate_percent" numeric(8, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_rate_tiers_min_non_negative" CHECK ("plan_rate_tiers"."min_amount_usdt" >= 0),
	CONSTRAINT "plan_rate_tiers_bounds_ordered" CHECK ("plan_rate_tiers"."max_amount_usdt" is null or "plan_rate_tiers"."max_amount_usdt" > "plan_rate_tiers"."min_amount_usdt"),
	CONSTRAINT "plan_rate_tiers_rate_positive" CHECK ("plan_rate_tiers"."rate_percent" > 0)
);
--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "applied_tier_id" text;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "applied_tier_min_usdt" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "applied_tier_max_usdt" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "applied_rate_percent" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD COLUMN "release_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plan_rate_tiers" ADD CONSTRAINT "plan_rate_tiers_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_rate_tiers_plan_min_key" ON "plan_rate_tiers" USING btree ("plan_id","min_amount_usdt");--> statement-breakpoint
CREATE INDEX "plan_rate_tiers_plan_idx" ON "plan_rate_tiers" USING btree ("plan_id","min_amount_usdt");--> statement-breakpoint
CREATE INDEX "deposits_unacknowledged_idx" ON "deposits" USING btree ("user_id","status","acknowledged_at");--> statement-breakpoint
CREATE INDEX "commission_entries_release_idx" ON "commission_entries" USING btree ("status","release_at");--> statement-breakpoint
/*
 * Backfill, hand-added to a generated migration.
 *
 * Every deposit already credited before this column existed is marked
 * acknowledged. `acknowledged_at is null` is the query the new "USDT deposit
 * confirmed" state runs, so without this line the first person to open the
 * wallet after deploying would be shown every historical deposit they have
 * ever made as a fresh arrival — which is precisely the defect the column was
 * added to fix. `updated_at` is used rather than `now()` so the marker does
 * not claim the person acknowledged it at deploy time.
 *
 * Deliberately NOT backfilled: `commission_entries.release_at`. A historical
 * pending entry has no schedule it was accrued under, and inventing one would
 * be inventing a date on which somebody's money becomes payable. Those stay
 * null, which the release job reads as "not scheduled — an operator decides".
 */
UPDATE "deposits" SET "acknowledged_at" = coalesce("credited_at", "updated_at") WHERE "status" = 'credited' AND "acknowledged_at" IS NULL;
