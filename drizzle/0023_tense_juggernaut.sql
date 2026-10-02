CREATE TYPE "public"."ticket_author" AS ENUM('customer', 'support');--> statement-breakpoint
CREATE TYPE "public"."ticket_category" AS ENUM('deposit', 'withdrawal', 'investment', 'verification', 'account', 'other');--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ticket_replied';--> statement-breakpoint
ALTER TYPE "public"."audit_action" ADD VALUE 'ticket_status_changed';--> statement-breakpoint
ALTER TYPE "public"."audit_target_type" ADD VALUE 'ticket';--> statement-breakpoint
ALTER TYPE "public"."pipeline" ADD VALUE 'support';--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author" "ticket_author" NOT NULL,
	"author_name" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "category" "ticket_category" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ticket_messages_ticket_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX "support_tickets_status_updated_idx" ON "support_tickets" USING btree ("status","updated_at");