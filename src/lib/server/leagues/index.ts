import { getDb, type Player } from '../db';
import { teams, players, syncState } from '../db/schema';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { reportError } from '../alerts';
import { teamDbId, type LeagueId } from '$lib/leagues';
import { nhlAdapter } from './nhl';
import { pwhlAdapter } from './pwhl';
import { ohlAdapter, qmjhlAdapter, whlAdapter } from './chl';
import { inBackoff, type FailureState } from './backoff';
import type { LeagueAdapter, LeagueTeam } from './types';

const ADAPTERS: LeagueAdapter[] = [nhlAdapter, pwhlAdapter, whlAdapter, ohlAdapter, qmjhlAdapter];
const ADAPTERS_BY_ID = new Map(ADAPTERS.map((a) => [a.id, a]));

/**
 * Rosters are fetched per team, when someone opens that team, and lists of
 * teams when someone opens the home page — so the work scales with what's
 * actually looked at instead of with the number of leagues. Freshness lives in
 * the database, so a restart doesn't re-fetch everything.
 */
export const ROSTER_TTL = 12 * 60 * 60 * 1000;
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

/**
 * Sync keys are per team (`roster:nhl:TOR`); alerts want per league. When an
 * upstream goes down every one of its teams fails the same way, and 101
 * separate alerts is a worse signal than one that says it happened 101 times.
 */
function alertScope(key: string): string {
	return `sync:${key.split(':').slice(0, 2).join(':')}`;
}

export function once(key: string, run: () => Promise<void>): Promise<void> {
	const existing = inFlight.get(key);
	if (existing) return existing;

	const job = run()
		.catch((err) => {
			// Discarding the fingerprint reportError hands back: nothing here has a
			// visitor to show it to, and the sync failure is already on the
			// dashboard under it.
			reportError({
				source: 'sync',
				message: `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
				stack: err instanceof Error ? err.stack : `key: ${key}`,
				route: alertScope(key)
			});
		})
		.finally(() => inFlight.delete(key));
	inFlight.set(key, job);
	return job;
}

export function withTimeout(work: Promise<void>, ms: number): Promise<void> {
	return Promise.race([work, sleep(ms).then(() => {})]);
}

/** Whether a key is still inside the backoff window from its last failure. */
function backingOff(state: FailureState | undefined): boolean {
	return inBackoff(state, Date.now());
}

/** Record a success: refresh the timestamp and forget any failure streak. */
function markSynced(key: string) {
	const db = getDb();
	const syncedAt = Date.now();
	db.insert(syncState)
		.values({ key, syncedAt, failedAt: null, failureCount: 0 })
		.onConflictDoUpdate({
			target: syncState.key,
			set: { syncedAt, failedAt: null, failureCount: 0 }
		})
		.run();
}

/**
 * Record a failure, extending the streak. `syncedAt` is 0 for a key that has
 * never succeeded — see the schema comment; nothing reads it as a real time.
 */
function markFailed(key: string) {
	const db = getDb();
	const now = Date.now();
	db.insert(syncState)
		.values({ key, syncedAt: 0, failedAt: now, failureCount: 1 })
		.onConflictDoUpdate({
			target: syncState.key,
			set: { failedAt: now, failureCount: sql`${syncState.failureCount} + 1` }
		})
		.run();
}

/**
 * Clear a failure streak without touching `syncedAt` — for rosters, whose
 * freshness is recorded on the teams table instead. A no-op when the key has
 * never failed, which is the common case.
 */
function clearFailure(key: string) {
	getDb()
		.update(syncState)
		.set({ failedAt: null, failureCount: 0 })
		.where(eq(syncState.key, key))
		.run();
}

function failureState(key: string): FailureState | undefined {
	return getDb().select().from(syncState).where(eq(syncState.key, key)).get();
}

export function isFresh(syncedAt: number | null | undefined, ttl: number): boolean {
	return syncedAt != null && syncedAt > Date.now() - ttl;
}

/** Refresh a league's teams: names, logos, and which teams still exist. */
export async function syncTeamList(adapter: LeagueAdapter): Promise<void> {
	let leagueTeams: LeagueTeam[];
	try {
		leagueTeams = await adapter.fetchTeams();
	} catch (err) {
		markFailed(teamListKey(adapter.id));
		reportError({
			source: 'sync',
			message: `Failed to fetch ${adapter.id} team list`,
			stack: err instanceof Error ? err.stack : String(err),
			route: `sync:teams:${adapter.id}`
		});
		return;
	}
	if (leagueTeams.length === 0) {
		// Don't wipe the league over a flaky/empty response.
		markFailed(teamListKey(adapter.id));
		reportError({
			source: 'sync',
			message: `${adapter.id} returned no teams; skipping sync`,
			route: `sync:teams:${adapter.id}`
		});
		return;
	}

	const activeIds = leagueTeams.map((t) => teamDbId(adapter.id, t.code));

	getDb().transaction((tx) => {
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
export async function syncRoster(adapter: LeagueAdapter, team: LeagueTeam): Promise<void> {
	const dbId = teamDbId(adapter.id, team.code);

	let result = await adapter.fetchRoster(team);
	if (!result.ok && result.reason === 'transient') {
		// Worth one more attempt — waiting out the league's own retry delay when
		// it gave one, within reason.
		await sleep(Math.min(result.retryAfter ?? RETRY_DELAY, MAX_RETRY_DELAY));
		result = await adapter.fetchRoster(team);
	}
	if (!result.ok) {
		// Backoff is per team, not per league: one team's roster 404ing shouldn't
		// stop the other hundred from refreshing.
		markFailed(rosterKey(dbId));
		// Alerts, though, are scoped to the league — when an upstream goes down
		// every one of its teams fails the same way, and an outage reads better as
		// one problem with a high count than as a hundred separate ones.
		reportError({
			source: 'sync',
			message: `Roster sync failed for ${adapter.id} (${result.reason}); keeping existing players`,
			stack: `team: ${dbId}`,
			route: `sync:roster:${adapter.id}`
		});
		return;
	}

	const rosterPlayers = result.players;
	const rosterIds = rosterPlayers.map((p) => p.id);

	getDb().transaction((tx) => {
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

	// Outside the transaction: the roster is what mattered, and a failed bit of
	// bookkeeping shouldn't roll back a successful sync.
	clearFailure(rosterKey(dbId));
}

function teamRow(dbId: string) {
	return getDb().select().from(teams).where(eq(teams.id, dbId)).get();
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
	const db = getDb();
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
			.map((s) => [s.key, s])
	);

	const blocking: Promise<void>[] = [];
	for (const adapter of ADAPTERS) {
		const key = teamListKey(adapter.id);
		if (isFresh(state.get(key)?.syncedAt, TEAM_LIST_TTL)) continue;
		// A league that just failed is left alone until its backoff expires. This
		// is also what stops a cold database plus a failing upstream from making
		// every home-page request wait the full blocking timeout: no job is
		// started, so there is nothing to block on.
		if (backingOff(state.get(key))) continue;

		const job = once(key, () => syncTeamList(adapter));
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
	const state = getDb()
		.select()
		.from(syncState)
		.where(eq(syncState.key, teamListKey(league)))
		.get();
	if (isFresh(state?.syncedAt, TEAM_LIST_TTL)) return undefined;
	// Nor while the league is backing off — otherwise a deep link into a cold
	// database during an outage waits the full blocking timeout, every time.
	if (backingOff(state)) return undefined;

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

	const stale = adapter && row && !isFresh(row.rosterSyncedAt, ROSTER_TTL);
	// The most exposed path of the three. Because failures used to go unrecorded,
	// a team whose roster couldn't be fetched blocked for up to 8s on *every*
	// visit — and the sitemap invites a crawler to walk every team page in turn.
	if (stale && !backingOff(failureState(rosterKey(dbId)))) {
		await withTimeout(
			once(rosterKey(dbId), () => syncRoster(adapter, toLeagueTeam(row))),
			BLOCKING_TIMEOUT
		);
	}

	return getDb().select().from(players).where(eq(players.teamId, dbId)).all();
}

/** Refresh everything, ignoring TTLs. Used by the manual sync endpoint. */
export async function syncRosters(): Promise<void> {
	for (const adapter of ADAPTERS) {
		console.log(`Syncing ${adapter.id.toUpperCase()} rosters...`);
		await once(teamListKey(adapter.id), () => syncTeamList(adapter));

		const leagueTeams = getDb().select().from(teams).where(eq(teams.league, adapter.id)).all();
		for (const [i, row] of leagueTeams.entries()) {
			if (i > 0) await sleep(FULL_SYNC_DELAY);
			await once(rosterKey(row.id), () => syncRoster(adapter, toLeagueTeam(row)));
		}
		console.log(`${adapter.id.toUpperCase()} roster sync complete`);
	}
}

let fullSync: Promise<void> | null = null;
let fullSyncStartedAt: number | null = null;

/**
 * Whether a full sync is in flight, and since when. The admin page uses the
 * start time to work out how far along it is: a team counts as done once its
 * `rosterSyncedAt` is newer than the run that's asking.
 */
export function fullSyncStatus(): { running: boolean; startedAt: number | null } {
	return { running: fullSync !== null, startedAt: fullSyncStartedAt };
}

/**
 * Run a full sync, coalescing concurrent callers onto a single run. Returns
 * whether this call started a new sync or joined one already in progress.
 */
export function syncRostersOnce(): { started: boolean; done: Promise<void> } {
	if (fullSync) return { started: false, done: fullSync };
	fullSyncStartedAt = Date.now();
	fullSync = syncRosters().finally(() => {
		fullSync = null;
	});
	return { started: true, done: fullSync };
}
