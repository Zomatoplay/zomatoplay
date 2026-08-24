ALTER TABLE "admin_agents" ADD COLUMN "auth_user_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_agents_auth_user_id_key" ON "admin_agents" USING btree ("auth_user_id");