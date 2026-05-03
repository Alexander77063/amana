DO $$ BEGIN
 CREATE TYPE "public"."rule_kind" AS ENUM('limit', 'category', 'time_window', 'allowlist', 'anomaly_threshold');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"kind" "rule_kind" NOT NULL,
	"config_json" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rules" ADD CONSTRAINT "rules_rule_set_id_rule_sets_id_fk" FOREIGN KEY ("rule_set_id") REFERENCES "public"."rule_sets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
