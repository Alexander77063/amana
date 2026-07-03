DO $$ BEGIN
 CREATE TYPE "public"."redemption_payout_status" AS ENUM('pending', 'paid', 'failed_retryable', 'stuck');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "ledger_account_kind" ADD VALUE 'commission';--> statement-breakpoint
ALTER TABLE "redemptions" ADD COLUMN "payout_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "redemptions" ADD COLUMN "payout_status" "redemption_payout_status";--> statement-breakpoint
ALTER TABLE "redemptions" ADD COLUMN "payout_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_payout_transaction_id_transactions_id_fk" FOREIGN KEY ("payout_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
