CREATE TABLE `photo_uploads` (
	`completion_id` text PRIMARY KEY NOT NULL,
	`chore_id` text NOT NULL,
	`chore_date` text NOT NULL,
	`completed_at` text NOT NULL,
	`local_uri` text NOT NULL,
	`content_type` text NOT NULL,
	`created_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL
);
