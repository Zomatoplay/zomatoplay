CREATE TYPE "public"."pipeline" AS ENUM('auth', 'kyc', 'deposit', 'chain_scanner', 'investment', 'withdrawal', 'email', 'database', 'admin');--> statement-breakpoint
CREATE TYPE "public"."pipeline_status" AS ENUM('started', 'ok', 'failed');--> statement-breakpoint
CREATE TABLE "pipeline_events" (
	"id" text PRIMARY KEY NOT NULL,
	"pipeline" "pipeline" NOT NULL,
	"operation" text NOT NULL,
	"status" "pipeline_status" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"duration_ms" integer,
	"correlation_id" text NOT NULL,
	"user_id" text,
	"actor_id" text,
	"actor_name" text,
	"subject_type" text,
	"subject_id" text,
	"message" text NOT NULL,
	"error_message" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_events" ADD CONSTRAINT "pipeline_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_events_occurred_idx" ON "pipeline_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "pipeline_events_pipeline_idx" ON "pipeline_events" USING btree ("pipeline");--> statement-breakpoint
CREATE INDEX "pipeline_events_status_idx" ON "pipeline_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pipeline_events_correlation_idx" ON "pipeline_events" USING btree ("correlation_id");--> statement-breakpoint
CREATE INDEX "pipeline_events_user_idx" ON "pipeline_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pipeline_events_subject_idx" ON "pipeline_events" USING btree ("subject_type","subject_id");