DO $$ BEGIN
 CREATE TYPE "public"."support_verification_rail" AS ENUM('push', 'sms', 'none');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."support_verification_status" AS ENUM('pending', 'verified', 'denied', 'expired');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid,
	"phone_e164" text NOT NULL,
	"user_id" uuid,
	"status" "support_verification_status" DEFAULT 'pending' NOT NULL,
	"rail" "support_verification_rail" NOT NULL,
	"match_number" smallint,
	"code_hash" text,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"session_expires_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_verifications" ADD CONSTRAINT "support_verifications_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "support_verifications" ADD CONSTRAINT "support_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_verifications_admin_created_idx" ON "support_verifications" USING btree ("admin_user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_verifications_phone_created_idx" ON "support_verifications" USING btree ("phone_e164","created_at");