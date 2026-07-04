DO $$ BEGIN
 CREATE TYPE "public"."redemption_status" AS ENUM('reserved', 'redeemed', 'expired', 'refunded');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "txn_kind" ADD VALUE 'marketplace_purchase';--> statement-breakpoint
ALTER TYPE "txn_kind" ADD VALUE 'redemption';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"buyer_user_id" uuid NOT NULL,
	"master_wallet_id" uuid NOT NULL,
	"sub_wallet_id" uuid,
	"retailer_id" text NOT NULL,
	"catalog_item_id" text NOT NULL,
	"deal_id" text,
	"gross_kobo" bigint NOT NULL,
	"discounted_kobo" bigint NOT NULL,
	"commission_kobo" bigint NOT NULL,
	"code" text NOT NULL,
	"qr_token" text NOT NULL,
	"status" "redemption_status" DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redemptions_code_unique" UNIQUE("code"),
	CONSTRAINT "redemptions_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_buyer_user_id_users_id_fk" FOREIGN KEY ("buyer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_master_wallet_id_master_wallets_id_fk" FOREIGN KEY ("master_wallet_id") REFERENCES "public"."master_wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_sub_wallet_id_sub_wallets_id_fk" FOREIGN KEY ("sub_wallet_id") REFERENCES "public"."sub_wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
