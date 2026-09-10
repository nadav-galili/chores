CREATE TYPE "public"."notification_kind" AS ENUM('kid_reminder', 'parent_digest', 'redemption_requested', 'reward_approved');--> statement-breakpoint
CREATE TYPE "public"."notification_target" AS ENUM('parent_device', 'child_device');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target" "notification_target" NOT NULL,
	"target_id" uuid,
	"kind" "notification_kind" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"ticket" text
);
--> statement-breakpoint
CREATE INDEX "notifications_ticket" ON "notifications" USING btree ("ticket");