ALTER TABLE `analytics_state` ADD `first_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_state` ADD `push_declined` integer DEFAULT false NOT NULL;