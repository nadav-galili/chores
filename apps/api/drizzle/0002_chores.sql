CREATE TYPE "public"."chore_kind" AS ENUM('once', 'daily', 'weekdays');--> statement-breakpoint
CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"child_id" uuid,
	"table" text NOT NULL,
	"row_id" uuid NOT NULL,
	"op" text NOT NULL,
	"row" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chore_assignees" (
	"chore_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	CONSTRAINT "chore_assignees_chore_id_child_id_pk" PRIMARY KEY("chore_id","child_id")
);
--> statement-breakpoint
CREATE TABLE "chores" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"title" text NOT NULL,
	"icon" text,
	"kind" "chore_kind" NOT NULL,
	"weekday_mask" smallint,
	"start_date" date,
	"end_date" date,
	"due_date" date,
	"requires_photo" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"field_clocks" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chore_assignees" ADD CONSTRAINT "chore_assignees_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_assignees" ADD CONSTRAINT "chore_assignees_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chores" ADD CONSTRAINT "chores_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chores" ADD CONSTRAINT "chores_updated_by_parents_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."parents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_log_household_seq" ON "change_log" ("household_id", "seq");--> statement-breakpoint
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
    rid := (r->>'id')::uuid;
    hid := (r->>'household_id')::uuid;
    cid := CASE WHEN TG_TABLE_NAME <> 'children' AND r ? 'child_id' THEN (r->>'child_id')::uuid ELSE NULL END;
  END IF;
  INSERT INTO change_log (household_id, child_id, "table", row_id, op, row)
  VALUES (hid, cid, TG_TABLE_NAME, rid, lower(TG_OP), r);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER chores_change_log AFTER INSERT OR UPDATE OR DELETE ON "chores"
  FOR EACH ROW EXECUTE FUNCTION log_change();--> statement-breakpoint
CREATE TRIGGER chore_assignees_change_log AFTER INSERT OR UPDATE OR DELETE ON "chore_assignees"
  FOR EACH ROW EXECUTE FUNCTION log_change();
