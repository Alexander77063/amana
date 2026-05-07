CREATE TABLE IF NOT EXISTS "subwallet_snooze" (
	"user_id" uuid NOT NULL,
	"sub_wallet_id" uuid NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subwallet_snooze_user_id_sub_wallet_id_pk" PRIMARY KEY("user_id","sub_wallet_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_quiet_hours" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subwallet_snooze" ADD CONSTRAINT "subwallet_snooze_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subwallet_snooze" ADD CONSTRAINT "subwallet_snooze_sub_wallet_id_sub_wallets_id_fk" FOREIGN KEY ("sub_wallet_id") REFERENCES "public"."sub_wallets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_quiet_hours" ADD CONSTRAINT "user_quiet_hours_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
