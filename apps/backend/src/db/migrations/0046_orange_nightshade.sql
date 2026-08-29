DO $$ BEGIN
 CREATE TYPE "public"."admin_grant_source" AS ENUM('config', 'admin');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."admin_role" AS ENUM('owner', 'admin', 'ops', 'support', 'auditor');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"role" "admin_role" NOT NULL,
	"granted" boolean NOT NULL,
	"granted_by_admin_user_id" uuid,
	"source" "admin_grant_source" NOT NULL,
	"reason" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_role_grants" ADD CONSTRAINT "admin_role_grants_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_role_grants" ADD CONSTRAINT "admin_role_grants_granted_by_admin_user_id_admin_users_id_fk" FOREIGN KEY ("granted_by_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_role_grants_by_admin_role" ON "admin_role_grants" USING btree ("admin_user_id","role");