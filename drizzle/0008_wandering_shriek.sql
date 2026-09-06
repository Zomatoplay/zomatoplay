CREATE TABLE "plan_rate_history" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"previous_rate_percent" numeric(8, 4),
	"new_rate_percent" numeric(8, 4) NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"changed_by_actor_id" text NOT NULL,
	"changed_by_label" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "investments" ADD COLUMN "earnings_credited_periods" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_rate_history" ADD CONSTRAINT "plan_rate_history_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_rate_history_plan_idx" ON "plan_rate_history" USING btree ("plan_id","effective_at");