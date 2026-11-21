import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { getDb, initDb } from '../db';
import { teams, players, syncState } from '../db/schema';
import { teamDbId, type LeagueId } from '#lib/leagues.ts';
import { inBackoff } from './backoff';
import type { LeagueAdapter, LeagueTeam, LeaguePlayer, RosterResult } from './types';

// Mocked so ensureTeam/ensureTeams/loadRoster — which build their adapter list
// from these modules at import time — can be driven by tests without any
// network. Declared with vi.hoisted because vi.mock factories run before the
// rest of this file's top-level code.
const nhlFetchTeams = vi.hoisted(() => vi.fn());
const nhlFetchRoster = vi.hoisted(() => vi.fn());

vi.mock('./nhl', () => ({
	nhlAdapter: { id: 'nhl', fetchTeams: nhlFetchTeams, fetchRoster: nhlFetchRoster }
}));
vi.mock('./pwhl', () => ({
	pwhlAdapter: { id: 'pwhl', fetchTeams: vi.fn().mockResolvedValue([]), fetchRoster: vi.fn() }
}));
vi.mock('./chl', () => ({
	whlAdapter: { id: 'whl', fetchTeams: vi.fn().mockResolvedValue([]), fetchRoster: vi.fn() },
	ohlAdapter: { id: 'ohl', fetchTeams: vi.fn().mockResolvedValue([]), fetchRoster: vi.fn() },
	qmjhlAdapter: { id: 'qmjhl', fetchTeams: vi.fn().mockResolvedValue([]), fetchRoster: vi.fn() }
}));

// Several cases below deliberately trigger a sync failure, which the real
// reportError would forward to Discord if ALERT_WEBHOOK_URL happens to be set
// in the environment running these tests (it is, in local dev). Mocked out
// entirely: this file is testing the sync layer's own bookkeeping, not
// alerting, and a test suite must never be able to reach a real webhook.
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../alerts', () => ({ reportError }));

const {
	ensureTeam,
	ensureTeams,
	fullSyncStatus,
	isFresh,
	isRosterStale,
	loadRoster,
	once,
	ROSTER_TTL,
	syncRoster,
	syncRostersOnce,
	syncStale,
	syncTeamList,
	teamListKey,
	withTimeout
} = await import('./index');

function fakeAdapter(id: LeagueId, overrides: Partial<LeagueAdapter> = {}): LeagueAdapter {
	return {
		id,
		fetchTeams: vi.fn().mockResolvedValue([]),
		fetchRoster: vi.fn().mockResolvedValue({ ok: true, players: [] } satisfies RosterResult),
		...overrides
	};
}

function leagueTeam(code: string, overrides: Partial<LeagueTeam> = {}): LeagueTeam {
	return {
		code,
		name: `${code} Team`,
		logoUrl: `https://example.com/${code}.svg`,
		...overrides
	};
}

function seedTeam(league: string, code: string, rosterSyncedAt: number | null = null): string {
	const id = teamDbId(league as LeagueId, code);
	getDb()
		.insert(teams)
		.values({
			id,
			league,
			name: `${code} Team`,
			abbreviation: code,
			logoUrl: `https://example.com/${code}.svg`,
			rosterSyncedAt
		})
		.run();
	return id;
}

function seedSyncState(
	key: string,
	state: { syncedAt: number; failedAt?: number; failureCount?: number }
) {
	getDb()
		.insert(syncState)
		.values({
			key,
			syncedAt: state.syncedAt,
			failedAt: state.failedAt ?? null,
			failureCount: state.failureCount ?? 0
		})
		.run();
}

function seedPlayer(
	teamId: string,
	league: string,
	id: number,
	overrides: Partial<LeaguePlayer> = {}
) {
	getDb()
		.insert(players)
		.values({
			league,
			id,
			teamId,
			firstName: overrides.firstName ?? 'First',
			lastName: overrides.lastName ?? 'Last',
			sweaterNumber: overrides.sweaterNumber ?? null,
			positionCode: overrides.positionCode ?? 'C',
			headshotUrl: overrides.headshotUrl ?? ''
		})
		.run();
}

beforeEach(() => {
	initDb(new Database(':memory:'));
	reportError.mockClear();
	nhlFetchTeams.mockReset().mockResolvedValue([]);
	nhlFetchRoster.mockReset().mockResolvedValue({ ok: true, players: [] } satisfies RosterResult);
});

describe('syncTeamList', () => {
	it('does not wipe a league’s teams when it returns none (empty-response guard)', async () => {
		seedTeam('nhl', 'TOR');
		seedTeam('nhl', 'BOS');

		await syncTeamList(fakeAdapter('nhl', { fetchTeams: vi.fn().mockResolvedValue([]) }));

		const rows = getDb().select().from(teams).where(eq(teams.league, 'nhl')).all();
		expect(rows).toHaveLength(2);
	});

	it('removes a team no longer reported by the league', async () => {
		seedTeam('nhl', 'TOR');
		seedTeam('nhl', 'BOS');

		await syncTeamList(
			fakeAdapter('nhl', { fetchTeams: vi.fn().mockResolvedValue([leagueTeam('TOR')]) })
		);

		const rows = getDb().select().from(teams).where(eq(teams.league, 'nhl')).all();
		expect(rows.map((r) => r.abbreviation)).toEqual(['TOR']);
	});

	it('records a failure without marking the sync fresh, when the fetch throws', async () => {
		await syncTeamList(
			fakeAdapter('nhl', { fetchTeams: vi.fn().mockRejectedValue(new Error('boom')) })
		);

		const state = getDb().select().from(syncState).where(eq(syncState.key, 'teams:nhl')).get();
		expect(state?.syncedAt).toBe(0);
		expect(state?.failureCount).toBe(1);
		expect(state?.failedAt).not.toBeNull();
	});

	it('records a failure without marking the sync fresh, when the league returns none', async () => {
		seedTeam('nhl', 'TOR');

		await syncTeamList(fakeAdapter('nhl', { fetchTeams: vi.fn().mockResolvedValue([]) }));

		const state = getDb().select().from(syncState).where(eq(syncState.key, 'teams:nhl')).get();
		expect(state?.syncedAt).toBe(0);
		expect(state?.failureCount).toBe(1);
	});

	// The deletes are the only statements here that can destroy another league's
	// data, and both are scoped by league. Each case below fails if one of those
	// filters (or the players delete itself) is dropped.
	it('leaves every other league’s teams and players alone', async () => {
		seedTeam('nhl', 'TOR');
		const pwhlTor = seedTeam('pwhl', 'TOR');
		const pwhlBos = seedTeam('pwhl', 'BOS');
		seedPlayer(pwhlTor, 'pwhl', 1);
		seedPlayer(pwhlBos, 'pwhl', 2);

		await syncTeamList(
			fakeAdapter('nhl', { fetchTeams: vi.fn().mockResolvedValue([leagueTeam('TOR')]) })
		);

		const pwhlTeams = getDb().select().from(teams).where(eq(teams.league, 'pwhl')).all();
		expect(pwhlTeams.map((t) => t.id).sort()).toEqual([pwhlBos, pwhlTor].sort());
		const pwhlPlayers = getDb().select().from(players).where(eq(players.league, 'pwhl')).all();
		expect(pwhlPlayers.map((p) => p.id).sort()).toEqual([1, 2]);
	});

	it('deletes a removed team’s players and keeps a kept team’s', async () => {
		const torId = seedTeam('nhl', 'TOR');
		const bosId = seedTeam('nhl', 'BOS');
		seedPlayer(torId, 'nhl', 1);
		seedPlayer(bosId, 'nhl', 2);
		seedPlayer(bosId, 'nhl', 3);

		await syncTeamList(
			fakeAdapter('nhl', { fetchTeams: vi.fn().mockResolvedValue([leagueTeam('TOR')]) })
		);

		expect(getDb().select().from(teams).where(eq(teams.id, bosId)).get()).toBeUndefined();
		const remaining = getDb().select().from(players).all();
		expect(remaining.map((p) => [p.teamId, p.id])).toEqual([[torId, 1]]);
	});

	it('an OHL sync that does not list Gatineau leaves qmjhl:GAT and its players alone', async () => {
		// The OHL and QMJHL feeds list each other's teams as interleague visitors,
		// so the same code turns up on both sides. Only the league column tells an
		// OHL sync that qmjhl:GAT is not its to remove.
		const gat = seedTeam('qmjhl', 'GAT');
		seedPlayer(gat, 'qmjhl', 64);
		const ohlGat = seedTeam('ohl', 'GAT');
		seedPlayer(ohlGat, 'ohl', 64);
		seedTeam('ohl', 'OTT');

		await syncTeamList(
			fakeAdapter('ohl', { fetchTeams: vi.fn().mockResolvedValue([leagueTeam('OTT')]) })
		);

		expect(gat).toBe('qmjhl:GAT');
		const allTeams = getDb().select().from(teams).all();
		expect(allTeams.map((t) => t.id).sort()).toEqual(['ohl:OTT', 'qmjhl:GAT']);
		const allPlayers = getDb().select().from(players).all();
		expect(allPlayers.map((p) => [p.league, p.teamId, p.id])).toEqual([['qmjhl', 'qmjhl:GAT', 64]]);
	});

	it('records a success: fresh timestamp, and any failure streak forgotten', async () => {
		const before = Date.now();
		seedSyncState('teams:nhl', { syncedAt: 0, failedAt: before - 1000, failureCount: 3 });

		await syncTeamList(
			fakeAdapter('nhl', { fetchTeams: vi.fn().mockResolvedValue([leagueTeam('TOR')]) })
		);

		const state = getDb().select().from(syncState).where(eq(syncState.key, 'teams:nhl')).get();
		expect(state?.syncedAt).toBeGreaterThanOrEqual(before);
		expect(state?.failedAt).toBeNull();
		expect(state?.failureCount).toBe(0);
	});

	describe('a list that would shrink the league', () => {
		// The PWHL, the smallest league there is: the guard has to stop a partial
		// response here without also stopping a real contraction.
		const PWHL = ['BOS', 'MIN', 'MTL', 'NY', 'OTT', 'SEA', 'TOR', 'VAN'];
		const DAY = 24 * 60 * 60 * 1000;

		/** Eight PWHL teams with a player each, and an NHL team that shares a code. */
		function seedLeagues() {
			PWHL.forEach((code, i) => seedPlayer(seedTeam('pwhl', code), 'pwhl', i + 1));
			seedPlayer(seedTeam('nhl', 'TOR'), 'nhl', 1);
			seedPlayer(seedTeam('nhl', 'UTA'), 'nhl', 2);
		}

		const listing = (codes: string[]) =>
			fakeAdapter('pwhl', {
				fetchTeams: vi.fn().mockResolvedValue(codes.map((code) => leagueTeam(code)))
			});

		const codesOf = (league: string) =>
			getDb()
				.select()
				.from(teams)
				.where(eq(teams.league, league))
				.all()
				.map((t) => t.abbreviation)
				.sort();

		const playerIdsOf = (league: string) =>
			getDb()
				.select()
				.from(players)
				.where(eq(players.league, league))
				.all()
				.map((p) => p.id)
				.sort((a, b) => a - b);

		it('changes nothing and records a failure when more than half the teams are missing', async () => {
			seedLeagues();
			const lastGood = Date.now() - 2 * DAY;
			seedSyncState('teams:pwhl', { syncedAt: lastGood });

			await syncTeamList(listing(['BOS', 'MIN', 'MTL']));

			expect(codesOf('pwhl')).toEqual([...PWHL].sort());
			expect(playerIdsOf('pwhl')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
			expect(codesOf('nhl')).toEqual(['TOR', 'UTA']);
			expect(playerIdsOf('nhl')).toEqual([1, 2]);
			// Not marked fresh, and backing off like any other failed sync.
			const state = getDb().select().from(syncState).where(eq(syncState.key, 'teams:pwhl')).get();
			expect(state?.syncedAt).toBe(lastGood);
			expect(state?.failureCount).toBe(1);
			expect(inBackoff(state, Date.now())).toBe(true);
		});

		it('does not rename or re-logo the teams it was sent, either', async () => {
			seedLeagues();

			await syncTeamList(
				fakeAdapter('pwhl', {
					fetchTeams: vi.fn().mockResolvedValue([leagueTeam('BOS', { name: 'Renamed' })])
				})
			);

			const bos = getDb().select().from(teams).where(eq(teams.id, 'pwhl:BOS')).get();
			expect(bos?.name).toBe('BOS Team');
		});

		it('still deletes a single dropped team and its players', async () => {
			seedLeagues();
			const before = Date.now();

			await syncTeamList(listing(PWHL.filter((code) => code !== 'TOR')));

			expect(codesOf('pwhl')).toEqual(PWHL.filter((code) => code !== 'TOR').sort());
			// TOR was the seventh team seeded, so its player is number 7.
			expect(playerIdsOf('pwhl')).toEqual([1, 2, 3, 4, 5, 6, 8]);
			// The NHL has a TOR of its own, which is none of this sync's business.
			expect(codesOf('nhl')).toEqual(['TOR', 'UTA']);
			expect(playerIdsOf('nhl')).toEqual([1, 2]);
			const state = getDb().select().from(syncState).where(eq(syncState.key, 'teams:pwhl')).get();
			expect(state?.syncedAt).toBeGreaterThanOrEqual(before);
			expect(state?.failureCount).toBe(0);
			expect(reportError).not.toHaveBeenCalled();
		});

		it('draws the line at more than half: four of eight goes through, three does not', async () => {
			seedLeagues();

			await syncTeamList(listing(['BOS', 'MIN', 'MTL']));
			expect(codesOf('pwhl')).toHaveLength(8);

			await syncTeamList(listing(['BOS', 'MIN', 'MTL', 'NY']));
			expect(codesOf('pwhl')).toEqual(['BOS', 'MIN', 'MTL', 'NY']);
		});

		it('counts each team once, however often the list repeats it', async () => {
			seedLeagues();

			await syncTeamList(listing(['BOS', 'BOS', 'BOS', 'MIN', 'MIN', 'MTL']));

			expect(codesOf('pwhl')).toHaveLength(8);
		});

		it('never holds up a first sync, which has nothing to lose', async () => {
			seedPlayer(seedTeam('nhl', 'TOR'), 'nhl', 1);

			await syncTeamList(listing(['BOS']));

			expect(codesOf('pwhl')).toEqual(['BOS']);
			expect(reportError).not.toHaveBeenCalled();
		});

		it('reports under one fingerprint per league, with the counts in the stack', async () => {
			seedLeagues();

			await syncTeamList(listing(['BOS', 'MIN', 'MTL']));
			await syncTeamList(listing(['VAN']));

			expect(reportError).toHaveBeenCalledTimes(2);
			const [first, second] = reportError.mock.calls.map(([report]) => report);
			expect(first.source).toBe('sync');
			expect(first.route).toBe('sync:teams:pwhl');
			expect(first.message).toBe(
				'pwhl team list lost more than half its teams; keeping existing teams'
			);
			// Message and route are the fingerprint, so neither may carry a count.
			expect(second.message).toBe(first.message);
			expect(second.route).toBe(first.route);
			expect(first.stack).toContain('stored teams: 8');
			expect(first.stack).toContain('listed teams: 3 (BOS, MIN, MTL)');
			expect(second.stack).toContain('listed teams: 1 (VAN)');
		});
	});
});

/** A roster containing just one player, for tests that need a non-empty sync. */
function rosterOf(id: number): RosterResult {
	return {
		ok: true,
		players: [
			{
				id,
				firstName: 'New',
				lastName: 'Player',
				sweaterNumber: 1,
				positionCode: 'C',
				headshotUrl: ''
			}
		]
	};
}

describe('syncRoster', () => {
	it('removes a team’s departed players, and leaves other teams alone', async () => {
		const torId = seedTeam('nhl', 'TOR');
		const bosId = seedTeam('nhl', 'BOS');
		seedPlayer(torId, 'nhl', 1);
		seedPlayer(torId, 'nhl', 2);
		seedPlayer(bosId, 'nhl', 3);

		await syncRoster(
			fakeAdapter('nhl', { fetchRoster: vi.fn().mockResolvedValue(rosterOf(2)) }),
			leagueTeam('TOR')
		);

		const tor = getDb().select().from(players).where(eq(players.teamId, torId)).all();
		expect(tor.map((p) => p.id)).toEqual([2]);
		expect(getDb().select().from(players).where(eq(players.teamId, bosId)).all()).toHaveLength(1);
	});

	it('keeps a team’s players and records a failure when its roster comes back empty', async () => {
		// New HockeyTech seasons open with only coaching staff listed, so an empty
		// roster must never be trusted to wipe a team (or be marked fresh).
		const torId = seedTeam('nhl', 'TOR');
		seedPlayer(torId, 'nhl', 1);
		seedPlayer(torId, 'nhl', 2);

		await syncRoster(
			fakeAdapter('nhl', {
				fetchRoster: vi.fn().mockResolvedValue({ ok: true, players: [] } satisfies RosterResult)
			}),
			leagueTeam('TOR')
		);

		expect(getDb().select().from(players).where(eq(players.teamId, torId)).all()).toHaveLength(2);
		expect(
			getDb().select().from(teams).where(eq(teams.id, torId)).get()?.rosterSyncedAt
		).toBeNull();
		const state = getDb()
			.select()
			.from(syncState)
			.where(eq(syncState.key, `roster:${torId}`))
			.get();
		expect(state?.failureCount).toBe(1);
	});

	it('does not delete a player already recorded as traded to another team', async () => {
		seedTeam('nhl', 'TOR');
		const bosId = seedTeam('nhl', 'BOS');
		// Player 10 already belongs to BOS in the database — say a previous BOS
		// sync recorded the trade. TOR's roster feed simply doesn't mention them.
		seedPlayer(bosId, 'nhl', 10);

		await syncRoster(
			fakeAdapter('nhl', { fetchRoster: vi.fn().mockResolvedValue(rosterOf(11)) }),
			leagueTeam('TOR')
		);

		const row = getDb().select().from(players).where(eq(players.id, 10)).get();
		expect(row?.teamId).toBe(bosId);
	});

	it('moves a player to the team whose roster now lists them', async () => {
		const torId = seedTeam('nhl', 'TOR');
		const bosId = seedTeam('nhl', 'BOS');
		seedPlayer(bosId, 'nhl', 10);
		seedPlayer(bosId, 'nhl', 11);

		await syncRoster(
			fakeAdapter('nhl', { fetchRoster: vi.fn().mockResolvedValue(rosterOf(10)) }),
			leagueTeam('TOR')
		);

		const moved = getDb().select().from(players).where(eq(players.id, 10)).get();
		expect(moved?.teamId).toBe(torId);
		// One row, not a copy on each team — and the rest of BOS is untouched.
		expect(getDb().select().from(players).where(eq(players.teamId, bosId)).all()).toHaveLength(1);
	});

	it('does not touch another league’s player with the same numeric id', async () => {
		const nhlTorId = seedTeam('nhl', 'TOR');
		const pwhlTorId = seedTeam('pwhl', 'TOR');
		seedPlayer(nhlTorId, 'nhl', 99);
		seedPlayer(pwhlTorId, 'pwhl', 99);

		await syncRoster(
			fakeAdapter('nhl', { fetchRoster: vi.fn().mockResolvedValue(rosterOf(100)) }),
			leagueTeam('TOR')
		);

		const nhlTor = getDb().select().from(players).where(eq(players.teamId, nhlTorId)).all();
		expect(nhlTor.map((p) => p.id)).toEqual([100]);
		const pwhlPlayer = getDb()
			.select()
			.from(players)
			.where(and(eq(players.league, 'pwhl'), eq(players.id, 99)))
			.get();
		expect(pwhlPlayer).toBeDefined();
		expect(pwhlPlayer?.teamId).toBe(pwhlTorId);
	});

	it('retries once on a transient failure, capping the wait at the retry ceiling', async () => {
		vi.useFakeTimers();
		try {
			seedTeam('nhl', 'TOR');
			const fetchRoster = vi
				.fn()
				.mockResolvedValueOnce({
					ok: false,
					reason: 'transient',
					retryAfter: 999_999
				} satisfies RosterResult)
				.mockResolvedValueOnce({ ok: true, players: [] } satisfies RosterResult);

			const promise = syncRoster(fakeAdapter('nhl', { fetchRoster }), leagueTeam('TOR'));
			// The upstream asked for a 999s backoff; the sync layer must cap that,
			// not wait it out. 16s clears the 15s ceiling with room to spare.
			await vi.advanceTimersByTimeAsync(16_000);
			await promise;

			expect(fetchRoster).toHaveBeenCalledTimes(2);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not retry a not-found roster', async () => {
		seedTeam('nhl', 'TOR');
		const fetchRoster = vi
			.fn()
			.mockResolvedValue({ ok: false, reason: 'not-found' } satisfies RosterResult);

		await syncRoster(fakeAdapter('nhl', { fetchRoster }), leagueTeam('TOR'));

		expect(fetchRoster).toHaveBeenCalledTimes(1);
	});

	it('records a failure and leaves existing players alone when the roster fetch fails', async () => {
		const torId = seedTeam('nhl', 'TOR');
		seedPlayer(torId, 'nhl', 1);

		await syncRoster(
			fakeAdapter('nhl', {
				fetchRoster: vi.fn().mockResolvedValue({ ok: false, reason: 'not-found' })
			}),
			leagueTeam('TOR')
		);

		expect(getDb().select().from(players).where(eq(players.teamId, torId)).all()).toHaveLength(1);
		const state = getDb()
			.select()
			.from(syncState)
			.where(eq(syncState.key, `roster:${torId}`))
			.get();
		expect(state?.failureCount).toBe(1);
	});
});

describe('sync failure alerts', () => {
	it('carry the adapter’s detail and the team, without splitting the fingerprint', async () => {
		seedTeam('nhl', 'TOR');
		seedTeam('nhl', 'BOS');
		const failing = (detail: string) =>
			fakeAdapter('nhl', {
				fetchRoster: vi
					.fn()
					.mockResolvedValue({ ok: false, reason: 'invalid', detail } satisfies RosterResult)
			});

		await syncRoster(failing('NHL roster TOR schema mismatch — forwards: bad'), leagueTeam('TOR'));
		await syncRoster(failing('NHL roster BOS schema mismatch — goalies: bad'), leagueTeam('BOS'));

		expect(reportError).toHaveBeenCalledTimes(2);
		const [tor, bos] = reportError.mock.calls.map(([report]) => report);
		expect(tor.stack).toContain('nhl:TOR');
		expect(tor.stack).toContain('NHL roster TOR schema mismatch — forwards: bad');
		expect(bos.stack).toContain('nhl:BOS');
		expect(bos.stack).toContain('goalies: bad');
		// The fingerprint is built from source, message and route. A league-wide
		// outage must stay one alert with a count, not one per team.
		expect(tor.message).toBe('Roster sync failed for nhl (invalid); keeping existing players');
		expect(bos.message).toBe(tor.message);
		expect(bos.route).toBe(tor.route);
		expect(tor.route).toBe('sync:roster:nhl');
		expect(tor.source).toBe('sync');
	});

	it('still name the team when the adapter has nothing more to say', async () => {
		seedTeam('nhl', 'TOR');

		await syncRoster(fakeAdapter('nhl'), leagueTeam('TOR'));

		expect(reportError).toHaveBeenCalledTimes(1);
		expect(reportError.mock.calls[0]?.[0]).toMatchObject({
			message: 'Roster sync failed for nhl (empty); keeping existing players',
			stack: 'team: nhl:TOR'
		});
	});
});

describe('a write that throws', () => {
	// NOT NULL is enforced by the database, so a row the adapter let through with
	// a missing name fails inside the transaction — after the fetch succeeded.
	const unwritable = (id: number): RosterResult => ({
		ok: true,
		players: [
			{
				id,
				firstName: 'New',
				lastName: null as unknown as string,
				sweaterNumber: 1,
				positionCode: 'C',
				headshotUrl: ''
			}
		]
	});

	it('is recorded as a roster failure, and rolls the roster back', async () => {
		const torId = seedTeam('nhl', 'TOR');
		seedPlayer(torId, 'nhl', 1);

		await expect(
			syncRoster(
				fakeAdapter('nhl', { fetchRoster: vi.fn().mockResolvedValue(unwritable(2)) }),
				leagueTeam('TOR')
			)
		).rejects.toThrow();

		const state = getDb()
			.select()
			.from(syncState)
			.where(eq(syncState.key, `roster:${torId}`))
			.get();
		expect(state?.failureCount).toBe(1);
		expect(state?.failedAt).not.toBeNull();
		const tor = getDb().select().from(players).where(eq(players.teamId, torId)).all();
		expect(tor.map((p) => p.id)).toEqual([1]);
		expect(
			getDb().select().from(teams).where(eq(teams.id, torId)).get()?.rosterSyncedAt
		).toBeNull();
	});

	it('stops the next visit from fetching the same roster again', async () => {
		const torId = seedTeam('nhl', 'TOR');
		seedPlayer(torId, 'nhl', 1);
		nhlFetchRoster.mockResolvedValue(unwritable(2));

		expect(await loadRoster('nhl', 'TOR')).toHaveLength(1);
		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);
		// once() is what reports a throw; the visitor still gets the stored roster.
		expect(reportError).toHaveBeenCalledTimes(1);
		expect(reportError.mock.calls[0]?.[0]).toMatchObject({ route: 'sync:roster:nhl' });

		expect(await loadRoster('nhl', 'TOR')).toHaveLength(1);
		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);
	});

	it('is recorded as a team-list failure, and is not marked fresh', async () => {
		seedTeam('nhl', 'TOR');
		const nameless = leagueTeam('BOS', { name: null as unknown as string });

		await expect(
			syncTeamList(
				fakeAdapter('nhl', {
					fetchTeams: vi.fn().mockResolvedValue([leagueTeam('TOR'), nameless])
				})
			)
		).rejects.toThrow();

		const state = getDb().select().from(syncState).where(eq(syncState.key, 'teams:nhl')).get();
		expect(state?.syncedAt).toBe(0);
		expect(state?.failureCount).toBe(1);
		const rows = getDb().select().from(teams).where(eq(teams.league, 'nhl')).all();
		expect(rows.map((r) => r.abbreviation)).toEqual(['TOR']);
	});
});

describe('syncRostersOnce', () => {
	it('never rejects, even when the walk itself throws', async () => {
		// Nothing awaits `done` in production, so a rejection here would be an
		// unhandled one. A closed database makes the read between two syncs throw,
		// which is outside anything once() catches.
		const client = new Database(':memory:');
		initDb(client);
		client.close();

		const { started, done } = syncRostersOnce();

		expect(started).toBe(true);
		expect(fullSyncStatus().running).toBe(true);
		await expect(done).resolves.toBeUndefined();
		expect(fullSyncStatus().running).toBe(false);
		const routes = reportError.mock.calls.map(([report]) => report.route);
		expect(routes).toContain('sync:full');
	});

	it('joins a run already in progress instead of starting a second', async () => {
		let release: (teams: LeagueTeam[]) => void = () => {};
		nhlFetchTeams.mockReturnValue(new Promise<LeagueTeam[]>((resolve) => (release = resolve)));

		const first = syncRostersOnce();
		const second = syncRostersOnce();

		expect(first.started).toBe(true);
		expect(second.started).toBe(false);
		expect(second.done).toBe(first.done);

		release([]);
		await first.done;
		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);
	});
});

describe('isRosterStale', () => {
	it('is stale when never synced, past the ttl, or holding no players', () => {
		const now = Date.now();
		const fresh = seedTeam('nhl', 'TOR', now - 60_000);
		seedPlayer(fresh, 'nhl', 1);
		const old = seedTeam('nhl', 'BOS', now - ROSTER_TTL - 60_000);
		seedPlayer(old, 'nhl', 2);
		const never = seedTeam('nhl', 'MTL');
		seedPlayer(never, 'nhl', 3);
		const emptied = seedTeam('nhl', 'OTT', now - 60_000);

		expect(isRosterStale({ id: fresh, rosterSyncedAt: now - 60_000 })).toBe(false);
		expect(isRosterStale({ id: old, rosterSyncedAt: now - ROSTER_TTL - 60_000 })).toBe(true);
		expect(isRosterStale({ id: never, rosterSyncedAt: null })).toBe(true);
		expect(isRosterStale({ id: emptied, rosterSyncedAt: now - 60_000 })).toBe(true);
	});
});

describe('teamListKey', () => {
	it('is the key the sync layer records a team list under', async () => {
		await syncTeamList(
			fakeAdapter('nhl', { fetchTeams: vi.fn().mockResolvedValue([leagueTeam('TOR')]) })
		);

		const keys = getDb().select({ key: syncState.key }).from(syncState).all();
		expect(keys).toEqual([{ key: teamListKey('nhl') }]);
		expect(teamListKey('nhl')).toBe('teams:nhl');
	});
});

describe('isFresh', () => {
	it('is fresh strictly within the ttl and stale at the boundary', () => {
		vi.useFakeTimers();
		try {
			const now = Date.now();
			expect(isFresh(now - 9, 10)).toBe(true);
			expect(isFresh(now - 10, 10)).toBe(false);
			expect(isFresh(null, 10)).toBe(false);
			expect(isFresh(undefined, 10)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('once', () => {
	it('joins concurrent callers onto a single run', async () => {
		let calls = 0;
		let resolveJob: () => void = () => {};
		const job = () =>
			new Promise<void>((resolve) => {
				calls++;
				resolveJob = resolve;
			});

		const first = once('coalesce-key', job);
		const second = once('coalesce-key', job);
		resolveJob();
		await Promise.all([first, second]);

		expect(calls).toBe(1);
	});

	it('releases the key afterwards, so the next call runs again', async () => {
		let calls = 0;
		await once('release-key', async () => {
			calls++;
		});
		await once('release-key', async () => {
			calls++;
		});

		expect(calls).toBe(2);
	});

	it('does not let a rejected job poison later calls for the same key', async () => {
		await once('poison-key', () => Promise.reject(new Error('boom')));

		let ran = false;
		await once('poison-key', async () => {
			ran = true;
		});

		expect(ran).toBe(true);
	});
});

describe('withTimeout', () => {
	it('returns once the work settles, well within the timeout', async () => {
		await expect(withTimeout(Promise.resolve(), 10_000)).resolves.toBeUndefined();
	});

	it('gives up after the timeout when the work never settles', async () => {
		vi.useFakeTimers();
		try {
			const never = new Promise<void>(() => {});
			const promise = withTimeout(never, 100);
			await vi.advanceTimersByTimeAsync(100);
			await expect(promise).resolves.toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('syncStale', () => {
	const HOUR = 60 * 60 * 1000;

	it('refreshes only the rosters past their ttl, leaving fresh and backing-off teams alone', async () => {
		const now = Date.now();
		// Every league's team list is fresh, so the sweep goes straight to rosters.
		for (const league of ['nhl', 'pwhl', 'whl', 'ohl', 'qmjhl']) {
			seedSyncState(`teams:${league}`, { syncedAt: now });
		}
		const stale = seedTeam('nhl', 'TOR', now - 13 * HOUR);
		seedPlayer(stale, 'nhl', 1);
		const fresh = seedTeam('nhl', 'BOS', now - 1 * HOUR);
		seedPlayer(fresh, 'nhl', 2);
		const failing = seedTeam('nhl', 'MTL', now - 13 * HOUR);
		seedSyncState(`roster:${failing}`, { syncedAt: 0, failedAt: now, failureCount: 1 });
		nhlFetchRoster.mockResolvedValue(rosterOf(1));

		await syncStale();

		expect(nhlFetchTeams).not.toHaveBeenCalled();
		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);
		expect(nhlFetchRoster).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOR' }));
		const row = getDb().select().from(teams).where(eq(teams.id, stale)).get();
		expect(row?.rosterSyncedAt).toBeGreaterThanOrEqual(now);
	});

	it('refreshes a stale team list before walking its rosters', async () => {
		const now = Date.now();
		for (const league of ['pwhl', 'whl', 'ohl', 'qmjhl']) {
			seedSyncState(`teams:${league}`, { syncedAt: now });
		}
		seedSyncState('teams:nhl', { syncedAt: now - 25 * HOUR });
		nhlFetchTeams.mockResolvedValueOnce([leagueTeam('TOR')]);

		await syncStale();

		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);
		// TOR was only just inserted by the list sync, so it has never had a
		// roster and is picked up in the same pass.
		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);
	});

	it('treats a team with no stored players as stale, however fresh its timestamp', async () => {
		const now = Date.now();
		for (const league of ['nhl', 'pwhl', 'whl', 'ohl', 'qmjhl']) {
			seedSyncState(`teams:${league}`, { syncedAt: now });
		}
		// Synced a minute ago, but emptied — say by a feed that opened the season
		// with nobody on it, before the empty-roster guard existed.
		seedTeam('nhl', 'TOR', now - 60_000);
		nhlFetchRoster.mockResolvedValue(rosterOf(1));

		await syncStale();

		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);
	});
});

// Without the backoff a league that is down looks like one never synced, and is
// asked again on every request.
describe('backoff integration', () => {
	it('a failing team-list sync is left alone by ensureTeam until its backoff expires', async () => {
		nhlFetchTeams.mockRejectedValueOnce(new Error('upstream down'));

		// Cold database, unknown code: ensureTeam has to sync the team list first.
		expect(await ensureTeam('nhl', 'TOR')).toBeUndefined();
		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);

		const state = getDb().select().from(syncState).where(eq(syncState.key, 'teams:nhl')).get();
		expect(inBackoff(state, Date.now())).toBe(true);

		// Still backing off: a second deep link must not trigger another fetch.
		expect(await ensureTeam('nhl', 'TOR')).toBeUndefined();
		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);
	});

	it('ensureTeams does not re-fetch a league that is still inside its backoff window', async () => {
		// Cold start for every league: nhl's job lands in ensureTeams' blocking
		// set (nothing is "known" yet), so the first call's await is guaranteed
		// to have run it — no fire-and-forget timing to race against.
		nhlFetchTeams.mockRejectedValueOnce(new Error('upstream down'));

		await ensureTeams();
		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);

		// Second call: nhl is still inside its backoff window, so the loop skips
		// starting a job for it at all, before ever touching `once`.
		await ensureTeams();
		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);
	});

	it('loadRoster serves what is in the database and does not retry while backing off', async () => {
		const torId = seedTeam('nhl', 'TOR');
		seedPlayer(torId, 'nhl', 1);
		nhlFetchRoster.mockResolvedValueOnce({ ok: false, reason: 'not-found' } satisfies RosterResult);

		const first = await loadRoster('nhl', 'TOR');
		expect(first).toHaveLength(1);
		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);

		const second = await loadRoster('nhl', 'TOR');
		expect(second).toHaveLength(1);
		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);
	});
});

describe('ensureTeams', () => {
	const HOUR = 60 * 60 * 1000;
	const OTHERS = ['pwhl', 'whl', 'ohl', 'qmjhl'];

	it('leaves a league alone while its team list is inside the ttl', async () => {
		const now = Date.now();
		for (const league of OTHERS) seedSyncState(`teams:${league}`, { syncedAt: now });
		seedSyncState('teams:nhl', { syncedAt: now - 23 * HOUR });
		seedTeam('nhl', 'TOR');

		await ensureTeams();

		expect(nhlFetchTeams).not.toHaveBeenCalled();
	});

	it('refreshes a league whose team list is past the ttl', async () => {
		const now = Date.now();
		for (const league of OTHERS) seedSyncState(`teams:${league}`, { syncedAt: now });
		seedSyncState('teams:nhl', { syncedAt: now - 25 * HOUR });
		seedTeam('nhl', 'TOR');
		nhlFetchTeams.mockResolvedValue([leagueTeam('TOR'), leagueTeam('BOS')]);

		await ensureTeams();
		// The league already has teams to show, so ensureTeams doesn't wait for the
		// refresh. Joining the in-flight job is how the test does.
		await once('teams:nhl', async () => {});

		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);
		const rows = getDb().select().from(teams).where(eq(teams.league, 'nhl')).all();
		expect(rows.map((r) => r.abbreviation).sort()).toEqual(['BOS', 'TOR']);
	});
});

describe('ensureTeam', () => {
	it('answers an unknown code from a fresh team list without asking the league', async () => {
		seedSyncState('teams:nhl', { syncedAt: Date.now() });
		seedTeam('nhl', 'TOR');

		expect(await ensureTeam('nhl', 'XXX')).toBeUndefined();

		expect(nhlFetchTeams).not.toHaveBeenCalled();
	});

	it('loads the team list for an unknown code when the list is stale', async () => {
		seedSyncState('teams:nhl', { syncedAt: Date.now() - 25 * 60 * 60 * 1000 });
		nhlFetchTeams.mockResolvedValue([leagueTeam('TOR')]);

		const row = await ensureTeam('nhl', 'TOR');

		expect(nhlFetchTeams).toHaveBeenCalledTimes(1);
		expect(row?.id).toBe('nhl:TOR');
	});

	it('returns a known team without touching sync state or the league', async () => {
		seedTeam('nhl', 'TOR');

		expect((await ensureTeam('nhl', 'TOR'))?.id).toBe('nhl:TOR');
		expect(nhlFetchTeams).not.toHaveBeenCalled();
	});
});

describe('loadRoster', () => {
	it('refreshes a team with no players even when its last sync is still fresh', async () => {
		// A team emptied before the empty-roster guard existed was marked fresh, and
		// must not have to wait out the TTL to recover.
		const torId = seedTeam('nhl', 'TOR');
		getDb().update(teams).set({ rosterSyncedAt: Date.now() }).where(eq(teams.id, torId)).run();
		nhlFetchRoster.mockResolvedValueOnce(rosterOf(7));

		const roster = await loadRoster('nhl', 'TOR');

		expect(nhlFetchRoster).toHaveBeenCalledTimes(1);
		expect(roster.map((p) => p.id)).toEqual([7]);
	});

	it('does not refresh a fresh team that has players', async () => {
		const torId = seedTeam('nhl', 'TOR');
		seedPlayer(torId, 'nhl', 1);
		getDb().update(teams).set({ rosterSyncedAt: Date.now() }).where(eq(teams.id, torId)).run();

		await loadRoster('nhl', 'TOR');

		expect(nhlFetchRoster).not.toHaveBeenCalled();
	});
});
