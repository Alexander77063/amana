DO $$ BEGIN
 CREATE TYPE "public"."vendor_claim_status" AS ENUM('pending', 'verified', 'expired', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_claim_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vendor_id" uuid NOT NULL,
	"phone" text NOT NULL,
	"status" "vendor_claim_status" DEFAULT 'pending' NOT NULL,
	"ownership_proof" text,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_claim_attempts" ADD CONSTRAINT "vendor_claim_attempts_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vendor_claim_attempts_one_pending" ON "vendor_claim_attempts" USING btree ("vendor_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_claim_attempts_phone_idx" ON "vendor_claim_attempts" USING btree ("phone");