PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`builtin_key` text,
	`title` text,
	`icon` text,
	`cost_coins` integer NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
-- `builtin_key` is new, so it is not in the SELECT: drizzle-kit names every column of the new
-- table on both sides, and the old one has no such column to read.
INSERT INTO `__new_rewards`("id", "household_id", "title", "icon", "cost_coins", "is_builtin", "active", "sort", "updated_at", "deleted_at") SELECT "id", "household_id", "title", "icon", "cost_coins", "is_builtin", "active", "sort", "updated_at", "deleted_at" FROM `rewards` WHERE "household_id" IS NOT NULL;--> statement-breakpoint
DROP TABLE `rewards`;--> statement-breakpoint
ALTER TABLE `__new_rewards` RENAME TO `rewards`;--> statement-breakpoint
PRAGMA foreign_keys=ON;