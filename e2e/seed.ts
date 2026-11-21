import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { LEAGUE_IDS } from '../src/lib/leagues';
import * as schema from '../src/lib/server/db/schema';

/**
 * A deterministic database the e2e suite runs against — no network, no
 * dependency on what the real leagues happen to be reporting today. Built
 * directly against better-sqlite3 and drizzle rather than importing
 * `#lib/server/db`: this script runs outside Vite, where that module's
 * `$app/env/private` import doesn't resolve.
 */
export const FIXTURE_PATH = resolve('e2e/fixture.db');

export const FIXTURE_TEAM = { league: 'nhl', code: 'TOR' };

/** A mix of positions, and one numberless player to exercise the
 *  pre-identified path (see #lib/game.ts's preIdentifiedIds). Exported so
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

/**
 * A second team, short enough to play to the end in a test. It is also where
 * the awkward rows live — two players on one number, an accented name, and one
 * long enough to wrap in an option button — so that FIXTURE_PLAYERS can stay
 * one wearer per number for the specs that look a player up by theirs.
 */
export const SHORT_TEAM = { league: 'nhl', code: 'MTL' };

export const SHORT_PLAYERS = [
	{ id: 101, firstName: 'Juraj', lastName: 'Slafkovský', sweaterNumber: 20, positionCode: 'L' },
	{ id: 102, firstName: 'Brendan', lastName: 'Gallagher', sweaterNumber: 11, positionCode: 'R' },
	{ id: 103, firstName: 'Saku', lastName: 'Koivu', sweaterNumber: 11, positionCode: 'C' },
	{
		id: 104,
		firstName: 'Pierre-Alexandre',
		lastName: 'Parenteau-Villeneuve',
		sweaterNumber: 71,
		positionCode: 'R'
	},
	{ id: 105, firstName: 'Lane', lastName: 'Hutson', sweaterNumber: 48, positionCode: 'D' },
	{ id: 106, firstName: 'Samuel', lastName: 'Montembeault', sweaterNumber: 35, positionCode: 'G' }
] as const;

/** A roster that has arrived without a single sweater number on it, as a
 *  league's can before a season: there is nothing to ask about. */
export const NUMBERLESS_TEAM = { league: 'nhl', code: 'UTA' };

const NUMBERLESS_PLAYERS = [
	{ id: 201, firstName: 'Camp', lastName: 'Invitee', sweaterNumber: null, positionCode: 'C' },
	{ id: 202, firstName: 'Another', lastName: 'Invitee', sweaterNumber: null, positionCode: 'D' }
] as const;

// Each of these codes has a logo in src/lib/assets/logos, which wins over
// logoUrl — so no page in the suite asks the league's CDN for one.
const TEAMS = [
	{
		...FIXTURE_TEAM,
		name: 'Toronto Maple Leafs',
		nameFr: 'Maple Leafs de Toronto',
		players: FIXTURE_PLAYERS
	},
	{
		...SHORT_TEAM,
		name: 'Montréal Canadiens',
		nameFr: 'Canadiens de Montréal',
		players: SHORT_PLAYERS
	},
	{
		...NUMBERLESS_TEAM,
		name: 'Utah Mammoth',
		nameFr: null,
		players: NUMBERLESS_PLAYERS
	}
];

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

	for (const team of TEAMS) {
		const teamId = `${team.league}:${team.code}`;

		db.insert(schema.teams)
			.values({
				id: teamId,
				league: team.league,
				name: team.name,
				nameFr: team.nameFr,
				abbreviation: team.code,
				logoUrl: `https://assets.nhle.com/logos/nhl/svg/${team.code}_light.svg`,
				// Fresh, so the app never tries to refresh this roster from the league.
				rosterSyncedAt: now
			})
			.run();

		db.insert(schema.players)
			.values(
				team.players.map((p) => ({
					league: team.league,
					id: p.id,
					teamId,
					firstName: p.firstName,
					lastName: p.lastName,
					sweaterNumber: p.sweaterNumber,
					positionCode: p.positionCode,
					headshotUrl: ''
				}))
			)
			.run();
	}

	// Every league's team list is marked fresh, so a cold visit never triggers
	// a real fetch to an upstream league API — the whole point of the fixture.
	db.insert(schema.syncState)
		.values(
			LEAGUE_IDS.map((league) => ({
				key: `teams:${league}`,
				syncedAt: now,
				failedAt: null,
				failureCount: 0
			}))
		)
		.run();

	client.close();
}
