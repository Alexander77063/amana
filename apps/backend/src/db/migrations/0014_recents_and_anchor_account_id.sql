CREATE TABLE IF NOT EXISTS "vendor_recents" (
	"sub_wallet_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vendor_recents_sub_wallet_id_bank_code_account_number_pk" PRIMARY KEY("sub_wallet_id","bank_code","account_number")
);
--> statement-breakpoint
ALTER TABLE "master_wallets" ADD COLUMN "anchor_account_id" text NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vendor_recents" ADD CONSTRAINT "vendor_recents_sub_wallet_id_sub_wallets_id_fk" FOREIGN KEY ("sub_wallet_id") REFERENCES "public"."sub_wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
