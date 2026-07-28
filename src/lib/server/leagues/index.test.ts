import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { getDb, initDb } from '../db';
import { teams, players, syncState } from '../db/schema';
import { teamDbId, type LeagueId } from '$lib/leagues';
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
vi.mock('../alerts', () => ({ reportError: vi.fn() }));

const {
	ensureTeam,
	ensureTeams,
	isFresh,
	loadRoster,
	once,
	syncRoster,
	syncTeamList,
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

function seedTeam(league: string, code: string): string {
	const id = teamDbId(league as LeagueId, code);
	getDb()
		.insert(teams)
		.values({
			id,
			league,
			name: `${code} Team`,
			abbreviation: code,
			logoUrl: `https://example.com/${code}.svg`
		})
		.run();
	return id;
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
});

describe('syncRoster', () => {
	it('clears a team’s own players when its roster comes back empty, and leaves other teams alone', async () => {
		const torId = seedTeam('nhl', 'TOR');
		const bosId = seedTeam('nhl', 'BOS');
		seedPlayer(torId, 'nhl', 1);
		seedPlayer(torId, 'nhl', 2);
		seedPlayer(bosId, 'nhl', 3);

		await syncRoster(
			fakeAdapter('nhl', {
				fetchRoster: vi.fn().mockResolvedValue({ ok: true, players: [] } satisfies RosterResult)
			}),
			leagueTeam('TOR')
		);

		expect(getDb().select().from(players).where(eq(players.teamId, torId)).all()).toHaveLength(0);
		expect(getDb().select().from(players).where(eq(players.teamId, bosId)).all()).toHaveLength(1);
	});

	it('does not delete a player already recorded as traded to another team', async () => {
		seedTeam('nhl', 'TOR');
		const bosId = seedTeam('nhl', 'BOS');
		// Player 10 already belongs to BOS in the database — say a previous BOS
		// sync recorded the trade. TOR's roster feed simply doesn't mention them.
		seedPlayer(bosId, 'nhl', 10);

		await syncRoster(
			fakeAdapter('nhl', {
				fetchRoster: vi.fn().mockResolvedValue({ ok: true, players: [] } satisfies RosterResult)
			}),
			leagueTeam('TOR')
		);

		const row = getDb().select().from(players).where(eq(players.id, 10)).get();
		expect(row?.teamId).toBe(bosId);
	});

	it('does not touch another league’s player with the same numeric id', async () => {
		const nhlTorId = seedTeam('nhl', 'TOR');
		const pwhlTorId = seedTeam('pwhl', 'TOR');
		seedPlayer(nhlTorId, 'nhl', 99);
		seedPlayer(pwhlTorId, 'pwhl', 99);

		await syncRoster(
			fakeAdapter('nhl', {
				fetchRoster: vi.fn().mockResolvedValue({ ok: true, players: [] } satisfies RosterResult)
			}),
			leagueTeam('TOR')
		);

		expect(getDb().select().from(players).where(eq(players.teamId, nhlTorId)).all()).toHaveLength(
			0
		);
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

describe('backoff integration (ABUSE-2)', () => {
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
