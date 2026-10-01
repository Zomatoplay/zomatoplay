ALTER TYPE "public"."admin_permission" ADD VALUE 'wallet_credits';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'wallet_manual_credit';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'withdrawal_password_reset';--> statement-breakpoint
ALTER TYPE "public"."transaction_type" ADD VALUE 'adjustment';--> statement-breakpoint
CREATE TABLE "withdrawal_passwords" (
	"user_id" text PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_credits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_usdt" numeric(20, 8) NOT NULL,
	"note" text,
	"idempotency_key" text NOT NULL,
	"ledger_tx_id" text NOT NULL,
	"created_by_id" text NOT NULL,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "manual_credits_amount_positive" CHECK ("manual_credits"."amount_usdt" > 0)
);
--> statement-breakpoint
ALTER TABLE "admin_agents" ADD COLUMN "phone_e164" text;--> statement-breakpoint
ALTER TABLE "admin_agents" ADD COLUMN "firebase_uid" text;--> statement-breakpoint
ALTER TABLE "admin_agents" ADD COLUMN "phone_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admin_agents" ADD COLUMN "session_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "withdrawal_passwords" ADD CONSTRAINT "withdrawal_passwords_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_credits" ADD CONSTRAINT "manual_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_credits" ADD CONSTRAINT "manual_credits_ledger_tx_id_transactions_id_fk" FOREIGN KEY ("ledger_tx_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_credits_idempotency_key" ON "manual_credits" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "manual_credits_user_idx" ON "manual_credits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "manual_credits_created_idx" ON "manual_credits" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_agents_phone_e164_key" ON "admin_agents" USING btree ("phone_e164");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_agents_firebase_uid_key" ON "admin_agents" USING btree ("firebase_uid");