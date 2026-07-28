import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../src/lib/server/db/schema';

/**
 * A deterministic database the e2e suite runs against — no network, no
 * dependency on what the real leagues happen to be reporting today. Built
 * directly against better-sqlite3 and drizzle rather than importing
 * `$lib/server/db`: this script runs outside Vite, so the `$lib` alias isn't
 * available to it.
 */
export const FIXTURE_PATH = resolve('e2e/fixture.db');

export const FIXTURE_TEAM = { league: 'nhl', code: 'TOR' };

/** A mix of positions, and one numberless player to exercise the
 *  pre-identified path (see $lib/game.ts's preIdentifiedIds). Exported so
 *  tests can look up which player a drawn number belongs to, for a
 *  guaranteed-correct guess. */
export const FIXTURE_PLAYERS = [
	{ id: 1, firstName: 'Auston', lastName: 'Matthews', sweaterNumber: 34, positionCode: 'C' },
	{ id: 2, firstName: 'Mitch', lastName: 'Marner', sweaterNumber: 16, positionCode: 'R' },
	{ id: 3, firstName: 'William', lastName: 'Nylander', sweaterNumber: 88, positionCode: 'R' },
	{ id: 4, firstName: 'John', lastName: 'Tavares', sweaterNumber: 91, positionCode: 'C' },
	{ id: 5, firstName: 'Matthew', lastName: 'Knies', sweaterNumber: 23, positionCode: 'L' },
	{ id: 6, firstName: 'Morgan', lastName: 'Rielly', sweaterNumber: 44, positionCode: 'D' },
	{ id: 7, firstName: 'Jake', lastName: 'McCabe', sweaterNumber: 22, positionCode: 'D' },
	{ id: 8, firstName: 'Chris', lastName: 'Tanev', sweaterNumber: 8, positionCode: 'D' },
	{ id: 9, firstName: 'Anthony', lastName: 'Stolarz', sweaterNumber: 41, positionCode: 'G' },
	{ id: 10, firstName: 'Joseph', lastName: 'Woll', sweaterNumber: 60, positionCode: 'G' },
	{ id: 11, firstName: 'No', lastName: 'Number', sweaterNumber: null, positionCode: 'C' }
] as const;

const LEAGUES = ['nhl', 'pwhl', 'whl', 'ohl', 'qmjhl'];

/**
 * Idempotent by clearing tables rather than deleting the file: on some
 * filesystems a just-closed file stays briefly locked (antivirus scanning,
 * cloud-sync clients, and the like), which makes delete-then-recreate on the
 * same path a race. Opening whatever's there, migrating (a no-op if already
 * current), and clearing the rows this fixture owns sidesteps the filesystem
 * entirely.
 */
export function seedFixture() {
	const client = new Database(FIXTURE_PATH);
	client.pragma('journal_mode = WAL');
	const db = drizzle(client, { schema });
	migrate(db, { migrationsFolder: resolve('drizzle') });

	db.delete(schema.players).run();
	db.delete(schema.teams).run();
	db.delete(schema.syncState).run();

	const now = Date.now();

	db.insert(schema.teams)
		.values({
			id: `${FIXTURE_TEAM.league}:${FIXTURE_TEAM.code}`,
			league: FIXTURE_TEAM.league,
			name: 'Toronto Maple Leafs',
			nameFr: 'Maple Leafs de Toronto',
			abbreviation: FIXTURE_TEAM.code,
			logoUrl: 'https://assets.nhle.com/logos/nhl/svg/TOR_light.svg',
			// Fresh, so the app never tries to refresh this roster from the league.
			rosterSyncedAt: now
		})
		.run();

	db.insert(schema.players)
		.values(
			FIXTURE_PLAYERS.map((p) => ({
				league: FIXTURE_TEAM.league,
				id: p.id,
				teamId: `${FIXTURE_TEAM.league}:${FIXTURE_TEAM.code}`,
				firstName: p.firstName,
				lastName: p.lastName,
				sweaterNumber: p.sweaterNumber,
				positionCode: p.positionCode,
				headshotUrl: ''
			}))
		)
		.run();

	// Every league's team list is marked fresh, so a cold visit never triggers
	// a real fetch to an upstream league API — the whole point of the fixture.
	db.insert(schema.syncState)
		.values(
			LEAGUES.map((league) => ({
				key: `teams:${league}`,
				syncedAt: now,
				failedAt: null,
				failureCount: 0
			}))
		)
		.run();

	client.close();
}
