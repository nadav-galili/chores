CREATE TABLE `flags` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pet_state` (
	`child_id` text PRIMARY KEY NOT NULL,
	`shown_level` integer DEFAULT 1 NOT NULL
);
