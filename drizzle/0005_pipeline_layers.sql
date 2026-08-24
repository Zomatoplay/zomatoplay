CREATE TYPE "public"."pipeline_actor_type" AS ENUM('user', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "public"."pipeline_layer" AS ENUM('client', 'server', 'database', 'external', 'blockchain');--> statement-breakpoint
ALTER TABLE "pipeline_events" ADD COLUMN "layer" "pipeline_layer" DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_events" ADD COLUMN "route" text;--> statement-breakpoint
ALTER TABLE "pipeline_events" ADD COLUMN "actor_type" "pipeline_actor_type" DEFAULT 'system' NOT NULL;--> statement-breakpoint
CREATE INDEX "pipeline_events_layer_idx" ON "pipeline_events" USING btree ("layer");--> statement-breakpoint
CREATE INDEX "pipeline_events_route_idx" ON "pipeline_events" USING btree ("route");