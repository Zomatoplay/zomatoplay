CREATE TYPE "public"."deposit_address_status" AS ENUM('available', 'assigned', 'retired');--> statement-breakpoint
CREATE TYPE "public"."deposit_asset" AS ENUM('usdt');--> statement-breakpoint
CREATE TABLE "deposit_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"chain" "chain" DEFAULT 'tron' NOT NULL,
	"network" "chain_network" DEFAULT 'shasta' NOT NULL,
	"asset" "deposit_asset" DEFAULT 'usdt' NOT NULL,
	"address" text NOT NULL,
	"derivation_index" integer,
	"status" "deposit_address_status" DEFAULT 'available' NOT NULL,
	"assigned_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_addresses_chain_network_address_key" ON "deposit_addresses" USING btree ("chain","network","address");--> statement-breakpoint
CREATE INDEX "deposit_addresses_user_idx" ON "deposit_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deposit_addresses_status_idx" ON "deposit_addresses" USING btree ("chain","network","status");