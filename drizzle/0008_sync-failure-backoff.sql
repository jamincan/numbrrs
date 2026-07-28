ALTER TABLE `sync_state` ADD `failed_at` integer;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `failure_count` integer DEFAULT 0 NOT NULL;