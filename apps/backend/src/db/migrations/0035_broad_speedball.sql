DO $$ BEGIN
 CREATE TYPE "public"."vendor_category_source" AS ENUM('observed', 'claimed', 'ops');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vendor_status" AS ENUM('observed', 'claimed', 'suspended');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_observations" (
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"household_id" uuid NOT NULL,
	"account_name" text NOT NULL,
	"settled_count" integer DEFAULT 1 NOT NULL,
	"category_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_observations_bank_code_account_number_household_id_pk" PRIMARY KEY("bank_code","account_number","household_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "vendor_status" DEFAULT 'observed' NOT NULL,
	"category" text,
	"category_source" "vendor_category_source" DEFAULT 'observed' NOT NULL,
	"category_household_count" integer,
	"public_code" text,
	"claimed_by_phone" text,
	"claimed_at" timestamp with time zone,
	"promoted_household_count" integer NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendors_public_code_unique" UNIQUE("public_code"),
	CONSTRAINT "vendors_bank_account_unique" UNIQUE("bank_code","account_number")
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "vendor_category_enforced" boolean;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "vendor_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "resolved_category" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_observations" ADD CONSTRAINT "vendor_observations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "vendor_observations_last_seen_idx" ON "vendor_observations" USING btree ("last_seen_at");