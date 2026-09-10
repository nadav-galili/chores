CREATE TABLE `notification_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`push_token` text,
	`reminder_time` text,
	`updated_at` text NOT NULL
);
