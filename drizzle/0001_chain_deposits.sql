CREATE TYPE "public"."chain" AS ENUM('tron');--> statement-breakpoint
CREATE TYPE "public"."chain_network" AS ENUM('mainnet', 'shasta', 'nile');--> statement-breakpoint
CREATE TYPE "public"."deposit_verification" AS ENUM('unverified', 'verified', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."deposit_status" ADD VALUE 'ignored';--> statement-breakpoint
CREATE TABLE "investment_earnings" (
	"id" text PRIMARY KEY NOT NULL,
	"investment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"period_key" text NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"credited_at" timestamp with time zone,
	"ledger_tx_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_scan_state" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" "chain" DEFAULT 'tron' NOT NULL,
	"network" "chain_network" DEFAULT 'shasta' NOT NULL,
	"address" text NOT NULL,
	"last_block_number" bigint,
	"last_timestamp" timestamp with time zone,
	"last_scan_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposits" DROP CONSTRAINT "deposits_user_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "deposits_tx_hash_idx";--> statement-breakpoint
ALTER TABLE "deposits" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "assigned_by" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "chain" "chain" DEFAULT 'tron' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "chain_network" "chain_network" DEFAULT 'shasta' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "token_contract" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "token_symbol" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "sender_address" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "block_number" bigint;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "block_timestamp" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "verification" "deposit_verification" DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "detected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "investment_earnings" ADD CONSTRAINT "investment_earnings_investment_id_investments_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."investments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_earnings" ADD CONSTRAINT "investment_earnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "investment_earnings_period_key" ON "investment_earnings" USING btree ("investment_id","period_key");--> statement-breakpoint
CREATE INDEX "investment_earnings_user_idx" ON "investment_earnings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investment_earnings_investment_idx" ON "investment_earnings" USING btree ("investment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_scan_state_target_key" ON "chain_scan_state" USING btree ("chain","network","address");--> statement-breakpoint
CREATE INDEX "chain_scan_state_address_idx" ON "chain_scan_state" USING btree ("address");--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_chain_tx_hash_key" ON "deposits" USING btree ("chain","tx_hash");--> statement-breakpoint
CREATE INDEX "deposits_unassigned_idx" ON "deposits" USING btree ("status","user_id");--> statement-breakpoint
CREATE INDEX "deposits_sender_idx" ON "deposits" USING btree ("sender_address");