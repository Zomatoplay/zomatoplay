ALTER TYPE "public"."deposit_request_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deposit_requests" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "deposit_requests_one_awaiting_per_user_key" ON "deposit_requests" USING btree ("user_id") WHERE "deposit_requests"."status" = 'awaiting_payment';