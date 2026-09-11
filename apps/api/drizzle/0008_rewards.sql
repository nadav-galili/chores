CREATE TYPE "public"."redemption_status" AS ENUM('requested', 'approved', 'declined', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."ledger_ref_type" ADD VALUE 'redemption';--> statement-breakpoint
CREATE TABLE "redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reward_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"cost_coins" integer NOT NULL,
	"status" "redemption_status" NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid
);
--> statement-breakpoint
CREATE TABLE "rewards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"builtin_key" text,
	"title" text,
	"icon" text,
	"cost_coins" integer NOT NULL,
	"is_builtin" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_reward_id_rewards_id_fk" FOREIGN KEY ("reward_id") REFERENCES "public"."rewards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redemptions" ADD CONSTRAINT "redemptions_decided_by_parents_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rewards" ADD CONSTRAINT "rewards_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redemptions_child" ON "redemptions" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "rewards_household" ON "rewards" USING btree ("household_id");--> statement-breakpoint
-- `log_change` already handles both: `rewards` carries a household and no child, so its rows are
-- logged with a NULL child_id (see HOUSEHOLD_WIDE in src/sync.ts); `redemptions` carries both.
CREATE TRIGGER rewards_change_log AFTER INSERT OR UPDATE OR DELETE ON "rewards"
  FOR EACH ROW EXECUTE FUNCTION log_change();--> statement-breakpoint
CREATE TRIGGER redemptions_change_log AFTER INSERT OR UPDATE OR DELETE ON "redemptions"
  FOR EACH ROW EXECUTE FUNCTION log_change();
