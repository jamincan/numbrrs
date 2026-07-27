CREATE TABLE `errors` (
	`fingerprint` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`route` text,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`count` integer NOT NULL,
	`notified_at` integer
);
--> statement-breakpoint
CREATE INDEX `errors_last_seen_idx` ON `errors` (`last_seen`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`day` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`route_id` text,
	`league` text,
	`team` text,
	`locale` text NOT NULL,
	`referrer_host` text,
	`visitor_hash` text NOT NULL,
	`props` text
);
--> statement-breakpoint
CREATE INDEX `events_day_idx` ON `events` (`day`);--> statement-breakpoint
CREATE INDEX `events_at_idx` ON `events` (`at`);