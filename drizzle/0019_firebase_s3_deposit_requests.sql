CREATE TYPE "public"."deposit_request_status" AS ENUM('awaiting_payment', 'verifying', 'credited', 'needs_review', 'expired', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'deposit_address_configured' BEFORE 'withdrawal_approved';--> statement-breakpoint
ALTER TYPE "public"."kyc_document_type" ADD VALUE 'aadhaar';--> statement-breakpoint
ALTER TYPE "public"."kyc_document_type" ADD VALUE 'pan';--> statement-breakpoint
CREATE TABLE "deposit_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"chain" "chain" DEFAULT 'tron' NOT NULL,
	"chain_network" "chain_network" NOT NULL,
	"asset" "deposit_asset" DEFAULT 'usdt' NOT NULL,
	"receiving_address" text NOT NULL,
	"requested_amount_usdt" numeric(20, 8) NOT NULL,
	"expected_amount_usdt" numeric(20, 8) NOT NULL,
	"status" "deposit_request_status" DEFAULT 'awaiting_payment' NOT NULL,
	"submitted_tx_hash" text,
	"submitted_at" timestamp with time zone,
	"deposit_id" text,
	"verified_amount_usdt" numeric(20, 8),
	"verified_at" timestamp with time zone,
	"review_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"chain" "chain" DEFAULT 'tron' NOT NULL,
	"chain_network" "chain_network" NOT NULL,
	"asset" "deposit_asset" DEFAULT 'usdt' NOT NULL,
	"receiving_address" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_id" text,
	"updated_by_name" text
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "firebase_uid" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_e164" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "unmatched_reason" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "storage_backend" text DEFAULT 'supabase' NOT NULL;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD CONSTRAINT "deposit_requests_deposit_id_deposits_id_fk" FOREIGN KEY ("deposit_id") REFERENCES "public"."deposits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_requests_user_idx" ON "deposit_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "deposit_requests_status_idx" ON "deposit_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deposit_requests_submitted_tx_idx" ON "deposit_requests" USING btree ("submitted_tx_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_requests_deposit_key" ON "deposit_requests" USING btree ("deposit_id") WHERE "deposit_requests"."deposit_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_requests_open_amount_key" ON "deposit_requests" USING btree ("chain_network","receiving_address","expected_amount_usdt") WHERE "deposit_requests"."status" in ('awaiting_payment', 'verifying');--> statement-breakpoint
CREATE INDEX "deposit_requests_match_idx" ON "deposit_requests" USING btree ("receiving_address","expected_amount_usdt");--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_settings_target_key" ON "deposit_settings" USING btree ("chain","chain_network","asset");--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_e164_key" ON "users" USING btree ("phone_e164");