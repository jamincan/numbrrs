import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const teams = sqliteTable('teams', {
	id: text('id').primaryKey(), // e.g. "nhl:TOR", "pwhl:TOR"
	league: text('league').notNull(), // e.g. "nhl", "pwhl"
	name: text('name').notNull(), // e.g. "Toronto Maple Leafs"
	// French name as reported by the league's own feed (currently only the NHL
	// publishes one); null when the feed doesn't say. Curated names in
	// $lib/team-names fill the gaps client-side.
	nameFr: text('name_fr'),
	abbreviation: text('abbreviation').notNull(), // e.g. "TOR"
	logoUrl: text('logo_url').notNull(),
	// When this team's roster was last fetched (epoch ms); null means never.
	// Rosters are synced on demand, one team at a time, so freshness is tracked
	// per team rather than for the league as a whole.
	rosterSyncedAt: integer('roster_synced_at')
});

/**
 * Freshness for things that aren't scoped to a single team — currently each
 * league's list of teams, under the key `teams:<league>`. Kept in the database
 * so it survives restarts; the app used to re-sync everything on every boot.
 */
export const syncState = sqliteTable('sync_state', {
	key: text('key').primaryKey(),
	syncedAt: integer('synced_at').notNull() // epoch ms
});

export const players = sqliteTable(
	'players',
	{
		// Player IDs are only unique within a league (PWHL IDs are small
		// integers), so the primary key is (league, id).
		league: text('league').notNull(),
		id: integer('id').notNull(),
		teamId: text('team_id')
			.notNull()
			.references(() => teams.id),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		sweaterNumber: integer('sweater_number'),
		positionCode: text('position_code').notNull(),
		headshotUrl: text('headshot_url').notNull()
	},
	(table) => [primaryKey({ columns: [table.league, table.id] })]
);
