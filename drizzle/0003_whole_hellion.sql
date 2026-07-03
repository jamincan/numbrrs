PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_players` (
	`id` integer PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`sweater_number` integer,
	`position_code` text NOT NULL,
	`headshot_url` text NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_players`("id", "team_id", "first_name", "last_name", "sweater_number", "position_code", "headshot_url") SELECT "id", "team_id", "first_name", "last_name", "sweater_number", "position_code", "headshot_url" FROM `players`;--> statement-breakpoint
DROP TABLE `players`;--> statement-breakpoint
ALTER TABLE `__new_players` RENAME TO `players`;--> statement-breakpoint
PRAGMA foreign_keys=ON;