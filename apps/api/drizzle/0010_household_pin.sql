ALTER TABLE "households" ADD COLUMN "pin_hash" text;--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "pin_salt" text;--> statement-breakpoint
ALTER TABLE "parents" DROP COLUMN "pin_hash";