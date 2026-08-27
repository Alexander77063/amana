DO $$ BEGIN
 CREATE TYPE "public"."vendor_consent_purpose" AS ENUM('service_terms', 'lender_introduction');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigserial NOT NULL,
	"vendor_id" uuid NOT NULL,
	"purpose" "vendor_consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"terms_version" text,
	"source" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_consents" ADD CONSTRAINT "vendor_consents_vendor_id_vendors_id_fk" FOREIGN KEY ("vendor_id") REFERENCES "public"."vendors"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_consents_by_vendor_purpose" ON "vendor_consents" USING btree ("vendor_id","purpose");