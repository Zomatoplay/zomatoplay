CREATE TABLE "deposit_address_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"address_id" text NOT NULL,
	"address" text NOT NULL,
	"chain" "chain" DEFAULT 'tron' NOT NULL,
	"network" "chain_network" DEFAULT 'shasta' NOT NULL,
	"asset" "deposit_asset" DEFAULT 'usdt' NOT NULL,
	"user_id" text NOT NULL,
	"assigned_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD COLUMN "last_user_id" text;--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD COLUMN "quarantine_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposit_address_assignments" ADD CONSTRAINT "deposit_address_assignments_address_id_deposit_addresses_id_fk" FOREIGN KEY ("address_id") REFERENCES "public"."deposit_addresses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_address_assignments" ADD CONSTRAINT "deposit_address_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_address_assignments_open_key" ON "deposit_address_assignments" USING btree ("address_id") WHERE "deposit_address_assignments"."released_at" is null;--> statement-breakpoint
CREATE INDEX "deposit_address_assignments_lookup_idx" ON "deposit_address_assignments" USING btree ("address","assigned_at");--> statement-breakpoint
CREATE INDEX "deposit_address_assignments_user_idx" ON "deposit_address_assignments" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "deposit_addresses" ADD CONSTRAINT "deposit_addresses_last_user_id_users_id_fk" FOREIGN KEY ("last_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deposit_addresses_assigned_idx" ON "deposit_addresses" USING btree ("status","assigned_at");