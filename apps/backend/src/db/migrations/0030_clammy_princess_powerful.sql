-- SP4: redemptions.{retailer_id,catalog_item_id,deal_id} were text placeholders in SP1.
-- Postgres has no assignment cast from text to uuid, so drizzle-kit's bare SET DATA TYPE
-- fails; the USING clauses below are hand-added. Every existing row was written by
-- purchaseService from real catalog uuids, so the cast is total. A row holding a non-uuid
-- would abort this migration loudly, which is the correct outcome -- it would mean a
-- redemption pointing at nothing, and silently dropping it would destroy financial history.
ALTER TABLE "redemptions" ALTER COLUMN "retailer_id" SET DATA TYPE uuid USING "retailer_id"::uuid;--> statement-breakpoint
ALTER TABLE "redemptions" ALTER COLUMN "catalog_item_id" SET DATA TYPE uuid USING "catalog_item_id"::uuid;--> statement-breakpoint
ALTER TABLE "redemptions" ALTER COLUMN "deal_id" SET DATA TYPE uuid USING "deal_id"::uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "retailers" ADD CONSTRAINT "retailers_anchor_business_customer_id_unique" UNIQUE("anchor_business_customer_id");