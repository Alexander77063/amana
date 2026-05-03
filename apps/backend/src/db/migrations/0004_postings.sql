CREATE TABLE IF NOT EXISTS "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"ledger_account_id" uuid NOT NULL,
	"debit_kobo" bigint DEFAULT 0 NOT NULL,
	"credit_kobo" bigint DEFAULT 0 NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "postings" ADD CONSTRAINT "postings_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "postings" ADD CONSTRAINT "postings_ledger_account_id_ledger_accounts_id_fk" FOREIGN KEY ("ledger_account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_debit_nonneg" CHECK ("postings"."debit_kobo" >= 0);
--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_credit_nonneg" CHECK ("postings"."credit_kobo" >= 0);
--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_exclusive_side" CHECK (("postings"."debit_kobo" > 0) <> ("postings"."credit_kobo" > 0));
