DO $$ BEGIN
 CREATE TYPE "public"."txn_kind" AS ENUM('spend', 'topup', 'refund', 'fee', 'reversal');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."txn_status" AS ENUM('draft', 'rule_eval', 'bump_pending', 'in_flight', 'settled', 'failed', 'reversed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"master_wallet_id" uuid NOT NULL,
	"sub_wallet_id" uuid,
	"kind" "txn_kind" NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"status" "txn_status" DEFAULT 'draft' NOT NULL,
	"idempotency_key" text NOT NULL,
	"nibss_session_id" text,
	"vendor_account" text,
	"vendor_bank_code" text,
	"vendor_resolved_name" text,
	"category" text,
	"anomaly_score" numeric(3, 2),
	"bump_request_id" uuid,
	"agent_note" text,
	"geolocation" geometry(Point,4326),
	"attached_media" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_master_wallet_id_master_wallets_id_fk" FOREIGN KEY ("master_wallet_id") REFERENCES "public"."master_wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sub_wallet_id_sub_wallets_id_fk" FOREIGN KEY ("sub_wallet_id") REFERENCES "public"."sub_wallets"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
