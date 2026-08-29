DO $$ BEGIN
 CREATE TYPE "public"."admin_approval_kind" AS ENUM('role_grant');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."admin_approval_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "admin_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "admin_approval_kind" NOT NULL,
	"status" "admin_approval_status" DEFAULT 'pending' NOT NULL,
	"payload_json" jsonb NOT NULL,
	"maker_admin_user_id" uuid NOT NULL,
	"checker_admin_user_id" uuid,
	"reason" text,
	"decision_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_maker_admin_user_id_admin_users_id_fk" FOREIGN KEY ("maker_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "admin_approvals" ADD CONSTRAINT "admin_approvals_checker_admin_user_id_admin_users_id_fk" FOREIGN KEY ("checker_admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_approvals_by_status" ON "admin_approvals" USING btree ("status","expires_at");