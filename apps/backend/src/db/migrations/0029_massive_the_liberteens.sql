DO $$ BEGIN
 CREATE TYPE "public"."vas_category" AS ENUM('airtime', 'data', 'electricity', 'cabletv');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vas_recipient_kind" AS ENUM('phone', 'meter', 'smartcard');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."vas_status" AS ENUM('pending', 'successful', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "txn_kind" ADD VALUE 'vas_purchase';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vas_beneficiaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sub_wallet_id" uuid NOT NULL,
	"kind" "vas_recipient_kind" NOT NULL,
	"value" text NOT NULL,
	"label" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "vas_beneficiaries_wallet_kind_value_uniq" UNIQUE("sub_wallet_id","kind","value")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vas_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"master_wallet_id" uuid NOT NULL,
	"sub_wallet_id" uuid,
	"category" "vas_category" NOT NULL,
	"provider" text NOT NULL,
	"product_slug" text,
	"recipient_kind" "vas_recipient_kind" NOT NULL,
	"recipient" text NOT NULL,
	"customer_name" text,
	"amount_kobo" bigint NOT NULL,
	"commission_kobo" bigint DEFAULT 0 NOT NULL,
	"anchor_bill_id" text,
	"token" text,
	"status" "vas_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vas_beneficiaries" ADD CONSTRAINT "vas_beneficiaries_sub_wallet_id_sub_wallets_id_fk" FOREIGN KEY ("sub_wallet_id") REFERENCES "public"."sub_wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vas_beneficiaries" ADD CONSTRAINT "vas_beneficiaries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vas_purchases" ADD CONSTRAINT "vas_purchases_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vas_purchases" ADD CONSTRAINT "vas_purchases_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vas_purchases" ADD CONSTRAINT "vas_purchases_master_wallet_id_master_wallets_id_fk" FOREIGN KEY ("master_wallet_id") REFERENCES "public"."master_wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vas_purchases" ADD CONSTRAINT "vas_purchases_sub_wallet_id_sub_wallets_id_fk" FOREIGN KEY ("sub_wallet_id") REFERENCES "public"."sub_wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
