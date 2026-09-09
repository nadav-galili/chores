CREATE TYPE "public"."completion_status" AS ENUM('accepted', 'pending_photo', 'rejected', 'undone');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('earn', 'bonus', 'streak', 'clawback', 'redeem', 'payout', 'adjust');--> statement-breakpoint
CREATE TYPE "public"."ledger_ref_type" AS ENUM('completion', 'chore_date', 'ledger_entry');--> statement-breakpoint
CREATE TABLE "applied_ops" (
	"op_id" uuid PRIMARY KEY NOT NULL,
	"device_id" uuid NOT NULL,
	"result" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "completions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"instance_id" uuid NOT NULL,
	"chore_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_date" date NOT NULL,
	"completed_at" timestamp with time zone NOT NULL,
	"device_id" uuid,
	"photo_key" text,
	"status" "completion_status" NOT NULL,
	"rejected_by" uuid,
	"rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "day_summaries" (
	"child_id" uuid NOT NULL,
	"chore_date" date NOT NULL,
	"due_count" integer NOT NULL,
	"done_count" integer NOT NULL,
	"complete" boolean NOT NULL,
	"streak_after" integer NOT NULL,
	CONSTRAINT "day_summaries_child_id_chore_date_pk" PRIMARY KEY("child_id","chore_date")
);
--> statement-breakpoint
CREATE TABLE "growth_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"chore_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"kind" "ledger_kind" NOT NULL,
	"coins" integer NOT NULL,
	"money_amount" integer,
	"ref_type" "ledger_ref_type",
	"ref_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"child_id" uuid NOT NULL,
	"xp" integer NOT NULL,
	"ref_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "completions" ADD CONSTRAINT "completions_rejected_by_parents_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "day_summaries" ADD CONSTRAINT "day_summaries_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_entries" ADD CONSTRAINT "growth_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "growth_entries" ADD CONSTRAINT "growth_entries_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_ref_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ref_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "completions_child_date" ON "completions" USING btree ("child_id","chore_date");--> statement-breakpoint
CREATE INDEX "growth_entries_child" ON "growth_entries" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_child" ON "ledger_entries" USING btree ("child_id");--> statement-breakpoint
CREATE INDEX "xp_events_child" ON "xp_events" USING btree ("child_id");--> statement-breakpoint
-- Two of the new tables carry no `id` (day_summaries) and two no `household_id` (day_summaries,
-- xp_events), so the logger falls back to the child: row_id is the child id there, and the
-- household is looked up from the child. The device keys every upsert off the row's own primary
-- key, so row_id only has to be stable, not meaningful.
CREATE OR REPLACE FUNCTION log_change() RETURNS trigger AS $$
DECLARE
  r jsonb;
  hid uuid;
  cid uuid;
  rid uuid;
BEGIN
  r := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  IF TG_TABLE_NAME = 'chore_assignees' THEN
    rid := (r->>'chore_id')::uuid;
    cid := (r->>'child_id')::uuid;
    SELECT household_id INTO hid FROM chores WHERE id = rid;
  ELSE
    cid := CASE
      WHEN TG_TABLE_NAME = 'children' THEN (r->>'id')::uuid
      WHEN r ? 'child_id' THEN (r->>'child_id')::uuid
      ELSE NULL
    END;
    rid := COALESCE((r->>'id')::uuid, cid);
    IF r ? 'household_id' THEN
      hid := (r->>'household_id')::uuid;
    ELSE
      SELECT household_id INTO hid FROM children WHERE id = cid;
    END IF;
  END IF;
  INSERT INTO change_log (household_id, child_id, "table", row_id, op, row)
  VALUES (hid, cid, TG_TABLE_NAME, rid, lower(TG_OP), r);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER completions_change_log AFTER INSERT OR UPDATE OR DELETE ON "completions"
  FOR EACH ROW EXECUTE FUNCTION log_change();--> statement-breakpoint
CREATE TRIGGER ledger_entries_change_log AFTER INSERT OR UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION log_change();--> statement-breakpoint
CREATE TRIGGER xp_events_change_log AFTER INSERT OR UPDATE OR DELETE ON "xp_events"
  FOR EACH ROW EXECUTE FUNCTION log_change();--> statement-breakpoint
CREATE TRIGGER day_summaries_change_log AFTER INSERT OR UPDATE OR DELETE ON "day_summaries"
  FOR EACH ROW EXECUTE FUNCTION log_change();--> statement-breakpoint
CREATE TRIGGER growth_entries_change_log AFTER INSERT OR UPDATE OR DELETE ON "growth_entries"
  FOR EACH ROW EXECUTE FUNCTION log_change();
