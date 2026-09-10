CREATE TYPE "public"."locale" AS ENUM('en', 'he');--> statement-breakpoint
ALTER TABLE "child_devices" ADD COLUMN "locale" "locale" DEFAULT 'en' NOT NULL;