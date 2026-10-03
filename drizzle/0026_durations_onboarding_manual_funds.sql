CREATE TABLE "plan_duration_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"duration_days" integer NOT NULL,
	"rate_percent" numeric(8, 4) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_duration_rates_duration_allowed" CHECK ("plan_duration_rates"."duration_days" in (7, 15, 30, 60, 90)),
	CONSTRAINT "plan_duration_rates_rate_positive" CHECK ("plan_duration_rates"."rate_percent" > 0)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_storage_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profile_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "schedule_version" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "applied_duration_rate_id" text;--> statement-breakpoint
ALTER TABLE "manual_credits" ADD COLUMN "direction" text DEFAULT 'credit' NOT NULL;--> statement-breakpoint
ALTER TABLE "manual_credits" ADD COLUMN "balance_after_usdt" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "plan_duration_rates" ADD CONSTRAINT "plan_duration_rates_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_duration_rates_plan_duration_key" ON "plan_duration_rates" USING btree ("plan_id","duration_days");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_gender_known" CHECK ("users"."gender" is null or "users"."gender" in ('male', 'female', 'not_sure'));--> statement-breakpoint
ALTER TABLE "manual_credits" ADD CONSTRAINT "manual_credits_direction_known" CHECK ("manual_credits"."direction" in ('credit', 'debit'));