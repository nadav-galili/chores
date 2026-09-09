CREATE TYPE "public"."instance_status" AS ENUM('due', 'done', 'pending_photo', 'redo');--> statement-breakpoint
CREATE TABLE "chore_instances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chore_id" uuid NOT NULL,
	"child_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"chore_date" date NOT NULL,
	"status" "instance_status" DEFAULT 'due' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chore_instances" ADD CONSTRAINT "chore_instances_chore_id_chores_id_fk" FOREIGN KEY ("chore_id") REFERENCES "public"."chores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_instances" ADD CONSTRAINT "chore_instances_child_id_children_id_fk" FOREIGN KEY ("child_id") REFERENCES "public"."children"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chore_instances" ADD CONSTRAINT "chore_instances_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chore_instances_chore_child_date" ON "chore_instances" USING btree ("chore_id","child_id","chore_date");--> statement-breakpoint
CREATE INDEX "chore_instances_child_date" ON "chore_instances" USING btree ("child_id","chore_date");--> statement-breakpoint
-- A child's own row is scoped to that child, so a kid device pulls it with `child_id = <its child>`.
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
    cid := CASE
      WHEN TG_TABLE_NAME = 'children' THEN rid
      WHEN r ? 'child_id' THEN (r->>'child_id')::uuid
      ELSE NULL
    END;
  END IF;
  INSERT INTO change_log (household_id, child_id, "table", row_id, op, row)
  VALUES (hid, cid, TG_TABLE_NAME, rid, lower(TG_OP), r);
  RETURN NULL;
END
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER children_change_log AFTER INSERT OR UPDATE OR DELETE ON "children"
  FOR EACH ROW EXECUTE FUNCTION log_change();--> statement-breakpoint
CREATE TRIGGER chore_instances_change_log AFTER INSERT OR UPDATE OR DELETE ON "chore_instances"
  FOR EACH ROW EXECUTE FUNCTION log_change();
