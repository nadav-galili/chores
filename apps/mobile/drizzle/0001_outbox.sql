CREATE TABLE `outbox` (
	`op_id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text
);
