DO $$ BEGIN
 CREATE TYPE "public"."sticker_status" AS ENUM('unbound', 'active', 'revoked');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vendor_stickers" (
	"uuid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"vendor_phone" text NOT NULL,
	"status" "sticker_status" DEFAULT 'unbound' NOT NULL,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
