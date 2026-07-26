import { db, type Player } from '../db';
import { teams, players, syncState } from '../db/schema';
import { and, eq, notInArray } from 'drizzle-orm';
import { teamDbId, type LeagueId } from '$lib/leagues';
import { nhlAdapter } from './nhl';
import { pwhlAdapter } from './pwhl';
import { ohlAdapter, qmjhlAdapter, whlAdapter } from './chl';
import type { LeagueAdapter, LeagueTeam } from './types';

const ADAPTERS: LeagueAdapter[] = [nhlAdapter, pwhlAdapter, whlAdapter, ohlAdapter, qmjhlAdapter];
const ADAPTERS_BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

/**
 * Rosters are fetched per team, when someone opens that team, and lists of
 * teams when someone opens the home page — so the work scales with what's
 * actually looked at instead of with the number of leagues. Freshness lives in
 * the database, so a restart doesn't re-fetch everything.
 */
const ROSTER_TTL = 12 * 60 * 60 * 1000;
const TEAM_LIST_TTL = 24 * 60 * 60 * 1000;

/**
 * Longest a page load waits on data it can't render without. Past this it
 * renders what's in the database (possibly nothing, which the UI handles) and
 * lets the sync finish in the background.
 */
const BLOCKING_TIMEOUT = 8000;

/** Delay between roster requests during a full sync, to stay polite. */
const FULL_SYNC_DELAY = 400;

/**
 * Backoff before retrying a transient roster failure, and the most a league's
 * Retry-After can stretch it. An upstream asking for an hour would otherwise
 * hold the in-flight slot (and, on Fly, the machine) that whole time — better
 * to give up and let the next visit try again.
 */
const RETRY_DELAY = 1000;
const MAX_RETRY_DELAY = 15_000;

const teamListKey = (league: string) => `teams:${league}`;
const rosterKey = (dbId: string) => `roster:${dbId}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Work in progress, keyed so concurrent callers join a running sync instead of
// starting a second one. Jobs never reject; failures are logged and leave the
// existing data alone.
const inFlight = new Map<string, Promise<void>>();

function once(key: string, run: () => Promise<void>): Promise<void> {
	const existing = inFlight.get(key);
	if (existing) return existing;

	const job = run()
		.catch((err) => console.error(`Sync ${key} failed:`, err))
		.finally(() => inFlight.delete(key));
	inFlight.set(key, job);
	return job;
}

function withTimeout(work: Promise<void>, ms: number): Promise<void> {
	return Promise.race([work, sleep(ms).then(() => {})]);
}

function markSynced(key: string) {
	const syncedAt = Date.now();
	db.insert(syncState)
		.values({ key, syncedAt })
		.onConflictDoUpdate({ target: syncState.key, set: { syncedAt } })
		.run();
}

function isFresh(syncedAt: number | null | undefined, ttl: number): boolean {
	return syncedAt != null && syncedAt > Date.now() - ttl;
}

/** Refresh a league's teams: names, logos, and which teams still exist. */
async function syncTeamList(adapter: LeagueAdapter): Promise<void> {
	let leagueTeams: LeagueTeam[];
	try {
		leagueTeams = await adapter.fetchTeams();
	} catch (err) {
		console.error(`Failed to fetch ${adapter.id} teams:`, err);
		return;
	}
	if (leagueTeams.length === 0) {
		// Don't wipe the league over a flaky/empty response.
		console.error(`${adapter.id} returned no teams; skipping sync`);
		return;
	}

	const activeIds = leagueTeams.map((t) => teamDbId(adapter.id, t.code));

	db.transaction((tx) => {
		for (const team of leagueTeams) {
			tx.insert(teams)
				.values({
					id: teamDbId(adapter.id, team.code),
					league: adapter.id,
					name: team.name,
					nameFr: team.nameFr ?? null,
					abbreviation: team.code,
					logoUrl: team.logoUrl
				})
				.onConflictDoUpdate({
					target: teams.id,
					set: { name: team.name, nameFr: team.nameFr ?? null, logoUrl: team.logoUrl }
				})
				.run();
		}

		// Remove teams (relocations, contractions) no longer reported by the
		// league. This is the only place teams are deleted — a single failed
		// roster request is far likelier to be a blip than a real removal.
		tx.delete(players)
			.where(and(eq(players.league, adapter.id), notInArray(players.teamId, activeIds)))
			.run();
		tx.delete(teams)
			.where(and(eq(teams.league, adapter.id), notInArray(teams.id, activeIds)))
			.run();
	});

	markSynced(teamListKey(adapter.id));
}

/** Refresh one team's roster. */
async function syncRoster(adapter: LeagueAdapter, team: LeagueTeam): Promise<void> {
	const dbId = teamDbId(adapter.id, team.code);

	let result = await adapter.fetchRoster(team);
	if (!result.ok && result.reason === 'transient') {
		// Worth one more attempt — waiting out the league's own retry delay when
		// it gave one, within reason.
		await sleep(Math.min(result.retryAfter ?? RETRY_DELAY, MAX_RETRY_DELAY));
		result = await adapter.fetchRoster(team);
	}
	if (!result.ok) {
		console.error(`Failed to sync roster for ${dbId}; keeping existing players`);
		return;
	}

	const rosterPlayers = result.players;
	const rosterIds = rosterPlayers.map((p) => p.id);

	db.transaction((tx) => {
		for (const p of rosterPlayers) {
			// Players without a sweater number are still stored (with a null
			// number); the game treats them as already-identified.
			tx.insert(players)
				.values({
					league: adapter.id,
					id: p.id,
					teamId: dbId,
					firstName: p.firstName,
					lastName: p.lastName,
					sweaterNumber: p.sweaterNumber,
					positionCode: p.positionCode,
					headshotUrl: p.headshotUrl
				})
				.onConflictDoUpdate({
					target: [players.league, players.id],
					set: {
						teamId: dbId,
						firstName: p.firstName,
						lastName: p.lastName,
						sweaterNumber: p.sweaterNumber,
						positionCode: p.positionCode,
						headshotUrl: p.headshotUrl
					}
				})
				.run();
		}

		// Remove players who are no longer on this team's roster (trades, waivers,
		// call-ups/downs). Scoped to teamId so a player who moved to another team
		// isn't deleted here — their new team's sync owns them.
		tx.delete(players)
			.where(
				rosterIds.length > 0
					? and(eq(players.teamId, dbId), notInArray(players.id, rosterIds))
					: eq(players.teamId, dbId)
			)
			.run();

		tx.update(teams).set({ rosterSyncedAt: Date.now() }).where(eq(teams.id, dbId)).run();
	});
}

function teamRow(dbId: string) {
	return db.select().from(teams).where(eq(teams.id, dbId)).get();
}

function toLeagueTeam(row: NonNullable<ReturnType<typeof teamRow>>): LeagueTeam {
	return {
		code: row.abbreviation,
		name: row.name,
		nameFr: row.nameFr ?? undefined,
		logoUrl: row.logoUrl
	};
}

/**
 * Make sure every league has a list of teams to show. Leagues that already have
 * teams refresh in the background; only a league with nothing to render is
 * waited on.
 */
export async function ensureTeams(): Promise<void> {
	const known = new Set(
		db
			.select({ league: teams.league })
			.from(teams)
			.all()
			.map((t) => t.league)
	);
	const state = new Map(
		db
			.select()
			.from(syncState)
			.all()
			.map((s) => [s.key, s.syncedAt])
	);

	const blocking: Promise<void>[] = [];
	for (const adapter of ADAPTERS) {
		if (isFresh(state.get(teamListKey(adapter.id)), TEAM_LIST_TTL)) continue;

		const job = once(teamListKey(adapter.id), () => syncTeamList(adapter));
		if (!known.has(adapter.id)) blocking.push(job);
	}

	if (blocking.length > 0)
		await withTimeout(
			Promise.all(blocking).then(() => {}),
			BLOCKING_TIMEOUT
		);
}

/**
 * Look up a team, loading the league's teams first if we've never seen it — a
 * deep link into a cold database, say. Cheap enough to wait on: it's what the
 * page needs before it can render anything at all.
 */
export async function ensureTeam(league: LeagueId, code: string) {
	const adapter = ADAPTERS_BY_ID.get(league);
	if (!adapter) return undefined;

	const dbId = teamDbId(league, code);
	const row = teamRow(dbId);
	if (row) return row;

	// Unknown code with a fresh team list means the team doesn't exist — don't
	// ask the league again. Without this check every request for a bogus code
	// (a typo'd link, a scanner) would trigger another round of upstream
	// fetches; once() only coalesces the concurrent ones.
	const state = db
		.select()
		.from(syncState)
		.where(eq(syncState.key, teamListKey(league)))
		.get();
	if (isFresh(state?.syncedAt, TEAM_LIST_TTL)) return undefined;

	await withTimeout(
		once(teamListKey(league), () => syncTeamList(adapter)),
		BLOCKING_TIMEOUT
	);
	return teamRow(dbId);
}

/**
 * A team's roster, refreshed first if it's gone stale. The page streams this in
 * rather than waiting on it, so a refresh costs a spinner in the roster area
 * instead of a blank page — and the game always starts from current data
 * instead of swapping players out from under someone mid-round.
 *
 * If the league can't be reached in time, whatever's in the database is served
 * instead; the next visit tries again, since only a successful sync is recorded.
 */
export async function loadRoster(league: LeagueId, code: string): Promise<Player[]> {
	const dbId = teamDbId(league, code);
	const adapter = ADAPTERS_BY_ID.get(league);
	const row = teamRow(dbId);

	if (adapter && row && !isFresh(row.rosterSyncedAt, ROSTER_TTL)) {
		await withTimeout(
			once(rosterKey(dbId), () => syncRoster(adapter, toLeagueTeam(row))),
			BLOCKING_TIMEOUT
		);
	}

	return db.select().from(players).where(eq(players.teamId, dbId)).all();
}

/** Refresh everything, ignoring TTLs. Used by the manual sync endpoint. */
export async function syncRosters(): Promise<void> {
	for (const adapter of ADAPTERS) {
		console.log(`Syncing ${adapter.id.toUpperCase()} rosters...`);
		await once(teamListKey(adapter.id), () => syncTeamList(adapter));

		const leagueTeams = db.select().from(teams).where(eq(teams.league, adapter.id)).all();
		for (const [i, row] of leagueTeams.entries()) {
			if (i > 0) await sleep(FULL_SYNC_DELAY);
			await once(rosterKey(row.id), () => syncRoster(adapter, toLeagueTeam(row)));
		}
		console.log(`${adapter.id.toUpperCase()} roster sync complete`);
	}
}

let fullSync: Promise<void> | null = null;

/**
 * Run a full sync, coalescing concurrent callers onto a single run. Returns
 * whether this call started a new sync or joined one already in progress.
 */
export function syncRostersOnce(): { started: boolean; done: Promise<void> } {
	if (fullSync) return { started: false, done: fullSync };
	fullSync = syncRosters().finally(() => {
		fullSync = null;
	});
	return { started: true, done: fullSync };
}
