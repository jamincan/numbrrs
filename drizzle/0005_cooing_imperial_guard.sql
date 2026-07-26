CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`synced_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `teams` ADD `roster_synced_at` integer;