CREATE TYPE "public"."admin_permission" AS ENUM('users', 'user_details', 'kyc', 'deposits', 'withdrawals', 'investments', 'plans', 'referrals', 'notifications', 'audit_logs', 'settings', 'security', 'agents');--> statement-breakpoint
CREATE TYPE "public"."admin_permission_level" AS ENUM('none', 'view', 'manage');--> statement-breakpoint
CREATE TYPE "public"."admin_role" AS ENUM('master_admin', 'agent');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'disabled', 'invited');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('kyc_approved', 'kyc_rejected', 'kyc_resubmission_requested', 'kyc_note_added', 'user_blocked', 'user_unblocked', 'user_suspended', 'user_deactivated', 'user_updated', 'user_password_reset', 'user_two_factor_reset', 'user_restriction_changed', 'device_logged_out', 'all_devices_logged_out', 'deposit_credited', 'deposit_failed', 'withdrawal_approved', 'withdrawal_rejected', 'withdrawal_marked_paid', 'plan_created', 'plan_updated', 'plan_disabled', 'plan_enabled', 'agent_created', 'agent_updated', 'agent_disabled', 'agent_enabled', 'agent_password_reset', 'agent_permissions_changed', 'notification_sent', 'settings_updated');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_target_type" AS ENUM('user', 'agent', 'plan', 'deposit', 'withdrawal', 'kyc', 'notification', 'settings');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('sent', 'scheduled', 'failed');--> statement-breakpoint
CREATE TYPE "public"."commission_status" AS ENUM('credited', 'pending', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USDT', 'INR');--> statement-breakpoint
CREATE TYPE "public"."deposit_network" AS ENUM('trc20', 'erc20', 'bep20', 'polygon');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('pending', 'detected', 'confirming', 'confirmed', 'credited', 'failed');--> statement-breakpoint
CREATE TYPE "public"."device_session_status" AS ENUM('active', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."investment_status" AS ENUM('active', 'matured', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."kyc_document_type" AS ENUM('passport', 'national_id', 'driving_licence');--> statement-breakpoint
CREATE TYPE "public"."kyc_review_status" AS ENUM('pending', 'under_review', 'approved', 'rejected', 'resubmission_requested');--> statement-breakpoint
CREATE TYPE "public"."kyc_status" AS ENUM('not_started', 'in_progress', 'pending_review', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."kyc_step_status" AS ENUM('complete', 'current', 'upcoming');--> statement-breakpoint
CREATE TYPE "public"."notification_audience" AS ENUM('single_user', 'all_users', 'kyc_pending', 'kyc_approved', 'active_investors', 'inactive_users', 'vip', 'blocked_users');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('deposit', 'withdrawal', 'investment', 'profit', 'referral', 'announcement');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'push');--> statement-breakpoint
CREATE TYPE "public"."notification_template" AS ENUM('announcement', 'kyc_reminder', 'deposit_credited', 'withdrawal_processed', 'investment_matured', 'custom');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('success', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('open', 'limited', 'closed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."referral_status" AS ENUM('active', 'registered', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."reward_frequency" AS ENUM('daily', 'weekly', 'monthly', 'on_maturity');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('conservative', 'balanced', 'growth');--> statement-breakpoint
CREATE TYPE "public"."security_event_type" AS ENUM('login', 'failed_login', 'password_changed', 'two_factor_changed', 'account_locked', 'device_logged_out', 'withdrawal_address_added');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('open', 'awaiting_reply', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('completed', 'pending', 'processing', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('deposit', 'withdrawal', 'investment', 'reward', 'referral');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive', 'blocked', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."vip_level" AS ENUM('vip1', 'vip2', 'vip3');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_status" AS ENUM('pending', 'under_review', 'approved', 'processing', 'paid', 'rejected', 'failed');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number_masked" text NOT NULL,
	"ifsc" text NOT NULL,
	"holder_name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"status" "ticket_status" NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_device_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"device" text NOT NULL,
	"browser" text NOT NULL,
	"os" text NOT NULL,
	"ip_address" text NOT NULL,
	"location" text NOT NULL,
	"logged_in_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"status" "device_session_status" DEFAULT 'active' NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_kyc_steps" (
	"user_id" text NOT NULL,
	"step_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" "kyc_step_status" DEFAULT 'upcoming' NOT NULL,
	CONSTRAINT "user_kyc_steps_user_id_step_id_pk" PRIMARY KEY("user_id","step_id")
);
--> statement-breakpoint
CREATE TABLE "user_security_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "security_event_type" NOT NULL,
	"description" text NOT NULL,
	"device" text NOT NULL,
	"ip_address" text NOT NULL,
	"location" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"outcome" "outcome" DEFAULT 'success' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"country" text DEFAULT 'India' NOT NULL,
	"avatar_url" text,
	"registered_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"kyc_status" "kyc_status" DEFAULT 'not_started' NOT NULL,
	"vip_level" "vip_level" DEFAULT 'vip1' NOT NULL,
	"referral_code" text NOT NULL,
	"referred_by_code" text,
	"referral_count" integer DEFAULT 0 NOT NULL,
	"wallet_address" text NOT NULL,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"google_auth_enabled" boolean DEFAULT false NOT NULL,
	"account_frozen" boolean DEFAULT false NOT NULL,
	"withdrawals_frozen" boolean DEFAULT false NOT NULL,
	"investments_frozen" boolean DEFAULT false NOT NULL,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"network" "deposit_network" NOT NULL,
	"address" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_balances" (
	"user_id" text PRIMARY KEY NOT NULL,
	"available" numeric(20, 8) DEFAULT 0 NOT NULL,
	"total_deposited" numeric(20, 8) DEFAULT 0 NOT NULL,
	"total_invested" numeric(20, 8) DEFAULT 0 NOT NULL,
	"total_withdrawn" numeric(20, 8) DEFAULT 0 NOT NULL,
	"total_profit" numeric(20, 8) DEFAULT 0 NOT NULL,
	"locked_in_investments" numeric(20, 8) DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_networks" (
	"id" "deposit_network" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"chain" text NOT NULL,
	"address" text NOT NULL,
	"min_deposit" numeric(20, 8) NOT NULL,
	"estimated_arrival" text NOT NULL,
	"required_confirmations" integer NOT NULL,
	"network_fee_note" text NOT NULL,
	"recommended" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"tagline" text NOT NULL,
	"description" text NOT NULL,
	"how_it_works" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"min_investment" numeric(20, 8) NOT NULL,
	"max_investment" numeric(20, 8) NOT NULL,
	"duration_days" integer NOT NULL,
	"estimated_return_percent" numeric(8, 4) NOT NULL,
	"estimated_return_low" numeric(8, 4) NOT NULL,
	"estimated_return_high" numeric(8, 4) NOT NULL,
	"reward_frequency" "reward_frequency" NOT NULL,
	"risk" "risk_level" NOT NULL,
	"status" "plan_status" DEFAULT 'open' NOT NULL,
	"capacity_filled_percent" integer,
	"highlights" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"conditions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"early_exit" text NOT NULL,
	"popular" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active_investments" integer DEFAULT 0 NOT NULL,
	"total_allocated" numeric(20, 8) DEFAULT 0 NOT NULL,
	"total_profit_paid" numeric(20, 8) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_name" text NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"profit" numeric(20, 8) DEFAULT 0 NOT NULL,
	"projected_profit" numeric(20, 8) DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"matures_at" timestamp with time zone NOT NULL,
	"duration_days" integer NOT NULL,
	"elapsed_days" integer DEFAULT 0 NOT NULL,
	"status" "investment_status" DEFAULT 'active' NOT NULL,
	"reward_frequency" "reward_frequency" NOT NULL,
	"next_reward_at" timestamp with time zone,
	"next_reward_amount" numeric(20, 8),
	"risk" "risk_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_usdt" numeric(20, 8) NOT NULL,
	"network" "deposit_network" NOT NULL,
	"wallet_address" text NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"credited_at" timestamp with time zone,
	"confirmations_current" integer DEFAULT 0 NOT NULL,
	"confirmations_required" integer NOT NULL,
	"status" "deposit_status" DEFAULT 'pending' NOT NULL,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" "transaction_type" NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"currency" "currency" DEFAULT 'USDT' NOT NULL,
	"status" "transaction_status" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"network" "deposit_network",
	"confirmations_current" integer,
	"confirmations_required" integer,
	"inr_amount" numeric(20, 2),
	"fee_usdt" numeric(20, 8),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"amount_usdt" numeric(20, 8) NOT NULL,
	"payout_rate" numeric(14, 6) NOT NULL,
	"flat_fee_usdt" numeric(20, 8) DEFAULT 0 NOT NULL,
	"percent_fee_usdt" numeric(20, 8) DEFAULT 0 NOT NULL,
	"total_fee_usdt" numeric(20, 8) DEFAULT 0 NOT NULL,
	"net_inr" numeric(20, 2) NOT NULL,
	"destination_label" text NOT NULL,
	"destination_bank_name" text NOT NULL,
	"destination_account_masked" text NOT NULL,
	"destination_ifsc" text NOT NULL,
	"destination_holder_name" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"status" "withdrawal_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"rejection_reason" text,
	"payout_reference" text
);
--> statement-breakpoint
CREATE TABLE "kyc_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"label" text NOT NULL,
	"type" "kyc_document_type" NOT NULL,
	"file_name" text NOT NULL,
	"uploaded_at" timestamp with time zone NOT NULL,
	"pages" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kyc_submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"status" "kyc_review_status" DEFAULT 'pending' NOT NULL,
	"legal_name" text NOT NULL,
	"date_of_birth" text NOT NULL,
	"nationality" text NOT NULL,
	"address" text NOT NULL,
	"document_type" "kyc_document_type" NOT NULL,
	"document_number_masked" text NOT NULL,
	"liveness_check_passed" boolean DEFAULT false NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commission_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"beneficiary_user_id" text NOT NULL,
	"source_user_id" text,
	"source_user_name" text NOT NULL,
	"tier" smallint DEFAULT 1 NOT NULL,
	"amount_usdt" numeric(20, 8) NOT NULL,
	"source_plan_name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"status" "commission_status" DEFAULT 'pending' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referral_accounts" (
	"user_id" text PRIMARY KEY NOT NULL,
	"direct_referrals" integer DEFAULT 0 NOT NULL,
	"indirect_referrals" integer DEFAULT 0 NOT NULL,
	"active_referrals" integer DEFAULT 0 NOT NULL,
	"team_volume_usdt" numeric(20, 8) DEFAULT 0 NOT NULL,
	"commission_earned_usdt" numeric(20, 8) DEFAULT 0 NOT NULL,
	"commission_pending_usdt" numeric(20, 8) DEFAULT 0 NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" text PRIMARY KEY NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referred_user_id" text,
	"name" text NOT NULL,
	"masked_email" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"status" "referral_status" DEFAULT 'registered' NOT NULL,
	"invested_amount" numeric(20, 8) DEFAULT 0 NOT NULL,
	"earned_from_referral" numeric(20, 8) DEFAULT 0 NOT NULL,
	"tier" smallint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vip_levels" (
	"id" "vip_level" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tier1_commission_percent" numeric(8, 4) NOT NULL,
	"tier2_commission_percent" numeric(8, 4) NOT NULL,
	"required_active_referrals" integer DEFAULT 0 NOT NULL,
	"required_team_volume_usdt" numeric(20, 8) DEFAULT 0 NOT NULL,
	"benefits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_campaigns" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" "notification_audience" NOT NULL,
	"target_user_label" text,
	"channels" "notification_channel"[] DEFAULT '{}' NOT NULL,
	"template_id" "notification_template" NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"sent_by" text NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"status" "campaign_status" DEFAULT 'sent' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_categories" (
	"id" "notification_category" PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"default_enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"category" "notification_category" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"read" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_preferences" (
	"user_id" text NOT NULL,
	"category" "notification_category" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_notification_preferences_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "admin_agent_permissions" (
	"agent_id" text NOT NULL,
	"permission" "admin_permission" NOT NULL,
	"level" "admin_permission_level" DEFAULT 'none' NOT NULL,
	CONSTRAINT "admin_agent_permissions_agent_id_permission_pk" PRIMARY KEY("agent_id","permission")
);
--> statement-breakpoint
CREATE TABLE "admin_agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "admin_role" DEFAULT 'agent' NOT NULL,
	"status" "agent_status" DEFAULT 'invited' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_active_at" timestamp with time zone,
	"note" text,
	"password_reset_requested_at" timestamp with time zone,
	CONSTRAINT "admin_agents_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"actor_name" text NOT NULL,
	"actor_role" "admin_role" NOT NULL,
	"action" "audit_action" NOT NULL,
	"target_type" "audit_target_type",
	"target_id" text,
	"target_label" text,
	"created_at" timestamp with time zone NOT NULL,
	"ip_address" text NOT NULL,
	"outcome" "audit_outcome" DEFAULT 'success' NOT NULL,
	"details" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"platform" jsonb NOT NULL,
	"currency" jsonb NOT NULL,
	"withdrawals" jsonb NOT NULL,
	"deposits" jsonb NOT NULL,
	"investments" jsonb NOT NULL,
	"referrals" jsonb NOT NULL,
	"security" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_device_sessions" ADD CONSTRAINT "user_device_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_kyc_steps" ADD CONSTRAINT "user_kyc_steps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_security_events" ADD CONSTRAINT "user_security_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_balances" ADD CONSTRAINT "wallet_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investments" ADD CONSTRAINT "investments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_submission_id_kyc_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."kyc_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_notes" ADD CONSTRAINT "kyc_notes_submission_id_kyc_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."kyc_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kyc_submissions" ADD CONSTRAINT "kyc_submissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_beneficiary_user_id_users_id_fk" FOREIGN KEY ("beneficiary_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_entries" ADD CONSTRAINT "commission_entries_source_user_id_users_id_fk" FOREIGN KEY ("source_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_accounts" ADD CONSTRAINT "referral_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_agent_permissions" ADD CONSTRAINT "admin_agent_permissions_agent_id_admin_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."admin_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_user_idx" ON "bank_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "support_tickets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_device_sessions_user_idx" ON "user_device_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_kyc_steps_user_idx" ON "user_kyc_steps" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_security_events_user_idx" ON "user_security_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_security_events_created_idx" ON "user_security_events" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_display_id_key" ON "users" USING btree ("display_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_referral_code_key" ON "users" USING btree ("referral_code");--> statement-breakpoint
CREATE INDEX "users_referred_by_code_idx" ON "users" USING btree ("referred_by_code");--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_kyc_status_idx" ON "users" USING btree ("kyc_status");--> statement-breakpoint
CREATE INDEX "users_wallet_address_idx" ON "users" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "wallet_addresses_user_idx" ON "wallet_addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_slug_key" ON "plans" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "plans_status_idx" ON "plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "investments_user_idx" ON "investments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "investments_plan_idx" ON "investments" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "investments_status_idx" ON "investments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "investments_started_idx" ON "investments" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "deposits_user_idx" ON "deposits" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "deposits_status_idx" ON "deposits" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deposits_created_idx" ON "deposits" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deposits_tx_hash_idx" ON "deposits" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "transactions_user_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_occurred_idx" ON "transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "transactions_type_idx" ON "transactions" USING btree ("type");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawals_requested_idx" ON "withdrawals" USING btree ("requested_at");--> statement-breakpoint
CREATE INDEX "kyc_documents_submission_idx" ON "kyc_documents" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "kyc_notes_submission_idx" ON "kyc_notes" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "kyc_submissions_user_idx" ON "kyc_submissions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "kyc_submissions_status_idx" ON "kyc_submissions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kyc_submissions_submitted_idx" ON "kyc_submissions" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "commission_entries_beneficiary_idx" ON "commission_entries" USING btree ("beneficiary_user_id");--> statement-breakpoint
CREATE INDEX "commission_entries_created_idx" ON "commission_entries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "commission_entries_status_idx" ON "commission_entries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referred_idx" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE INDEX "notification_campaigns_sent_idx" ON "notification_campaigns" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id","read");--> statement-breakpoint
CREATE INDEX "user_notification_preferences_user_idx" ON "user_notification_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "admin_agent_permissions_agent_idx" ON "admin_agent_permissions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "admin_agents_status_idx" ON "admin_agents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");