CREATE TABLE `children` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`first_name` text NOT NULL,
	`ui_mode` text NOT NULL,
	`pet_name` text NOT NULL,
	`reminder_time` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chore_assignees` (
	`chore_id` text NOT NULL,
	`child_id` text NOT NULL,
	PRIMARY KEY(`chore_id`, `child_id`)
);
--> statement-breakpoint
CREATE TABLE `chore_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`chore_id` text NOT NULL,
	`child_id` text NOT NULL,
	`household_id` text NOT NULL,
	`chore_date` text NOT NULL,
	`status` text DEFAULT 'due' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chore_instances_chore_child_date` ON `chore_instances` (`chore_id`,`child_id`,`chore_date`);--> statement-breakpoint
CREATE INDEX `chore_instances_child_date` ON `chore_instances` (`child_id`,`chore_date`);--> statement-breakpoint
CREATE TABLE `chores` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`title` text NOT NULL,
	`icon` text,
	`kind` text NOT NULL,
	`weekday_mask` integer,
	`start_date` text,
	`end_date` text,
	`due_date` text,
	`requires_photo` integer DEFAULT false NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL,
	`deleted_at` text,
	`field_clocks` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `completions` (
	`id` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`chore_id` text NOT NULL,
	`child_id` text NOT NULL,
	`household_id` text NOT NULL,
	`chore_date` text NOT NULL,
	`completed_at` text NOT NULL,
	`device_id` text,
	`photo_key` text,
	`status` text NOT NULL,
	`rejected_by` text,
	`rejected_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `day_summaries` (
	`child_id` text NOT NULL,
	`chore_date` text NOT NULL,
	`due_count` integer NOT NULL,
	`done_count` integer NOT NULL,
	`complete` integer NOT NULL,
	`streak_after` integer NOT NULL,
	PRIMARY KEY(`child_id`, `chore_date`)
);
--> statement-breakpoint
CREATE TABLE `growth_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_id` text NOT NULL,
	`chore_date` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ledger_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`child_id` text NOT NULL,
	`kind` text NOT NULL,
	`coins` integer NOT NULL,
	`money_amount` integer,
	`ref_type` text,
	`ref_id` text,
	`created_at` text NOT NULL,
	`created_by` text
);
--> statement-breakpoint
CREATE TABLE `redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`reward_id` text NOT NULL,
	`child_id` text NOT NULL,
	`household_id` text NOT NULL,
	`cost_coins` integer NOT NULL,
	`status` text NOT NULL,
	`requested_at` text NOT NULL,
	`decided_at` text,
	`decided_by` text
);
--> statement-breakpoint
CREATE TABLE `rewards` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text,
	`title` text NOT NULL,
	`icon` text,
	`cost_coins` integer NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `xp_events` (
	`id` text PRIMARY KEY NOT NULL,
	`child_id` text NOT NULL,
	`xp` integer NOT NULL,
	`ref_entry_id` text NOT NULL,
	`created_at` text NOT NULL
);
