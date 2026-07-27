import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

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

/**
 * One row per recorded visit or notable action, written from the request hook.
 *
 * Deliberately holds nothing that identifies a person: no IP, no user agent, no
 * cookie. `visitorHash` is derived from a salt that rotates every day and is
 * never written down, so it counts distinct visitors *within* a day and becomes
 * meaningless the moment the day rolls over. That's what makes this
 * banner-free, and it's also why cross-day retention is not answerable here —
 * by construction, not by omission.
 */
export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		at: integer('at').notNull(), // epoch ms
		// Local calendar day (YYYY-MM-DD) the event belongs to. Stored rather than
		// derived so the daily rollups are a plain GROUP BY, and so a row always
		// agrees with the salt window its visitorHash was built in.
		day: text('day').notNull(),
		name: text('name').notNull(), // 'pageview', and later gameplay events
		path: text('path').notNull(),
		// SvelteKit's route id, e.g. '/[[lang=locale]]/game/[league]/[team]'. Lets
		// the dashboard group every team page together without parsing paths.
		routeId: text('route_id'),
		league: text('league'),
		team: text('team'),
		locale: text('locale').notNull(),
		// Host only, never the full URL: enough to tell Discord from Google from
		// direct, without recording which page someone came from.
		referrerHost: text('referrer_host'),
		visitorHash: text('visitor_hash').notNull(),
		// Free-form JSON for events that carry extra detail. Nothing writes it
		// yet; it's here so adding gameplay events later needs no migration.
		props: text('props')
	},
	(table) => [index('events_day_idx').on(table.day), index('events_at_idx').on(table.at)]
);

/**
 * Errors, folded by fingerprint rather than appended one row per occurrence: a
 * single broken route can fire hundreds of times, and a table that grows with
 * the failure is the least useful thing to have during one. `count` and
 * `lastSeen` carry the volume instead.
 */
export const errors = sqliteTable(
	'errors',
	{
		// Hash of source + message + route. Same bug, same row.
		fingerprint: text('fingerprint').primaryKey(),
		source: text('source').notNull(), // 'server' | 'client' | 'sync'
		message: text('message').notNull(),
		stack: text('stack'),
		route: text('route'),
		firstSeen: integer('first_seen').notNull(), // epoch ms
		lastSeen: integer('last_seen').notNull(), // epoch ms
		count: integer('count').notNull(),
		// When this fingerprint was last pushed to Discord, so a flapping error
		// doesn't turn into a notification flood.
		notifiedAt: integer('notified_at')
	},
	(table) => [index('errors_last_seen_idx').on(table.lastSeen)]
);
