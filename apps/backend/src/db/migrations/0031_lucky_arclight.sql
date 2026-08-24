ALTER TYPE "user_role" ADD VALUE 'retailer';--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "retailers" ADD COLUMN "contact_phone" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "retailers" ADD CONSTRAINT "retailers_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "retailers" ADD CONSTRAINT "retailers_owner_user_id_unique" UNIQUE("owner_user_id");