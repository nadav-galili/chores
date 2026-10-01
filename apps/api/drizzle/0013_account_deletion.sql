ALTER TABLE "chores" DROP CONSTRAINT "chores_updated_by_parents_id_fk";
--> statement-breakpoint
ALTER TABLE "completions" DROP CONSTRAINT "completions_rejected_by_parents_id_fk";
--> statement-breakpoint
ALTER TABLE "join_codes" DROP CONSTRAINT "join_codes_created_by_parents_id_fk";
--> statement-breakpoint
ALTER TABLE "parent_invites" DROP CONSTRAINT "parent_invites_invited_by_parents_id_fk";
--> statement-breakpoint
ALTER TABLE "parent_invites" DROP CONSTRAINT "parent_invites_accepted_parent_id_parents_id_fk";
--> statement-breakpoint
ALTER TABLE "redemptions" DROP CONSTRAINT "redemptions_decided_by_parents_id_fk";
