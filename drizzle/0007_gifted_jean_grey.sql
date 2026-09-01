ALTER TABLE "kyc_documents" ADD COLUMN "storage_path" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "content_type" text;--> statement-breakpoint
ALTER TABLE "kyc_documents" ADD COLUMN "byte_size" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "kyc_documents_storage_path_key" ON "kyc_documents" USING btree ("storage_path");