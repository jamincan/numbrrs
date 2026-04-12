CREATE TABLE `metadata` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` integer PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`sweater_number` integer NOT NULL,
	`position_code` text NOT NULL,
	`headshot_url` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`abbreviation` text NOT NULL,
	`primary_color` text NOT NULL,
	`secondary_color` text NOT NULL
);
