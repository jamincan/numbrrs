-- All rows in players/teams are derived from league APIs and are rebuilt by
-- the roster sync that runs on boot, so this migration drops the data rather
-- than migrating it into the new league-scoped shape.
DROP TABLE `players`;--> statement-breakpoint
DROP TABLE `teams`;--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`league` text NOT NULL,
	`name` text NOT NULL,
	`abbreviation` text NOT NULL,
	`logo_url` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `players` (
	`league` text NOT NULL,
	`id` integer NOT NULL,
	`team_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`sweater_number` integer,
	`position_code` text NOT NULL,
	`headshot_url` text NOT NULL,
	PRIMARY KEY(`league`, `id`),
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
