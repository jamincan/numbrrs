import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeagueTeam } from './types';

// A failed standings fetch is reported, and the real reportError posts to a
// Discord webhook when one is configured. Nothing here may reach it.
const reportError = vi.hoisted(() => vi.fn());
vi.mock('../alerts', () => ({ reportError }));

const { nhlAdapter, retryAfterMs } = await import('./nhl');

const TOR: LeagueTeam = { code: 'TOR', name: 'Toronto Maple Leafs', logoUrl: '' };

function player(id: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		headshot: `https://assets.nhle.com/mugs/${id}.png`,
		firstName: { default: 'First' },
		lastName: { default: `Last${id}` },
		sweaterNumber: id,
		positionCode: 'C',
		...overrides
	};
}

/** Answers every request with one response, and records the URLs asked for. */
function serve(respond: () => Response | Promise<Response>): string[] {
	const urls: string[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			urls.push(url);
			return respond();
		})
	);
	return urls;
}

beforeEach(() => {
	reportError.mockClear();
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('nhlAdapter.fetchRoster', () => {
	it('maps the three position groups into one roster', async () => {
		const urls = serve(() =>
			Response.json({
				forwards: [player(34), player(16, { sweaterNumber: undefined })],
				defensemen: [player(44, { positionCode: 'D' })],
				goalies: [player(41, { positionCode: 'G', headshot: undefined })]
			})
		);

		const result = await nhlAdapter.fetchRoster(TOR);

		expect(urls).toEqual(['https://api-web.nhle.com/v1/roster/TOR/current']);
		expect(result).toEqual({
			ok: true,
			players: [
				{
					id: 44,
					firstName: 'First',
					lastName: 'Last44',
					sweaterNumber: 44,
					positionCode: 'D',
					headshotUrl: 'https://assets.nhle.com/mugs/44.png'
				},
				{
					id: 34,
					firstName: 'First',
					lastName: 'Last34',
					sweaterNumber: 34,
					positionCode: 'C',
					headshotUrl: 'https://assets.nhle.com/mugs/34.png'
				},
				{
					id: 16,
					firstName: 'First',
					lastName: 'Last16',
					sweaterNumber: null,
					positionCode: 'C',
					headshotUrl: 'https://assets.nhle.com/mugs/16.png'
				},
				{
					id: 41,
					firstName: 'First',
					lastName: 'Last41',
					sweaterNumber: 41,
					positionCode: 'G',
					headshotUrl: ''
				}
			]
		});
	});

	it('drops a player it cannot read and keeps the rest', async () => {
		serve(() =>
			Response.json({
				forwards: [player(34), { id: 'not-a-number' }, player(16)],
				defensemen: [],
				goalies: []
			})
		);

		const result = await nhlAdapter.fetchRoster(TOR);

		expect(result.ok && result.players.map((p) => p.id)).toEqual([34, 16]);
	});

	it('passes a 429’s Retry-After on in milliseconds', async () => {
		serve(() => new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }));

		expect(await nhlAdapter.fetchRoster(TOR)).toMatchObject({
			ok: false,
			reason: 'transient',
			retryAfter: 7000
		});
	});

	it('assumes a minute when a 429 names no delay', async () => {
		serve(() => new Response('slow down', { status: 429 }));

		expect(await nhlAdapter.fetchRoster(TOR)).toMatchObject({
			ok: false,
			reason: 'transient',
			retryAfter: 60_000
		});
	});

	it('never hands the sync layer a delay it cannot wait on', async () => {
		// Retry-After may be an HTTP date instead of a number of seconds. Read as a
		// number that is NaN, and a NaN timeout fires immediately.
		const inTenSeconds = new Date(Date.now() + 10_000).toUTCString();
		serve(() => new Response('', { status: 429, headers: { 'retry-after': inTenSeconds } }));

		const result = await nhlAdapter.fetchRoster(TOR);

		expect(result).toMatchObject({ ok: false, reason: 'transient' });
		const retryAfter = !result.ok && result.reason === 'transient' ? result.retryAfter : undefined;
		expect(Number.isFinite(retryAfter)).toBe(true);
		// toUTCString drops the milliseconds, so allow a second either side.
		expect(retryAfter).toBeGreaterThan(8000);
		expect(retryAfter).toBeLessThanOrEqual(10_000);
	});

	it('reports a 404 as not-found, which is never retried', async () => {
		serve(() => new Response('', { status: 404 }));

		expect(await nhlAdapter.fetchRoster(TOR)).toMatchObject({ ok: false, reason: 'not-found' });
	});

	it('reports any other bad status as transient', async () => {
		serve(() => new Response('', { status: 503 }));

		const result = await nhlAdapter.fetchRoster(TOR);

		expect(result).toMatchObject({ ok: false, reason: 'transient' });
		expect(!result.ok && result.reason === 'transient' && result.retryAfter).toBeUndefined();
	});

	it('reports a network failure as transient rather than throwing', async () => {
		serve(() => Promise.reject(new Error('socket hang up')));

		expect(await nhlAdapter.fetchRoster(TOR)).toMatchObject({ ok: false, reason: 'transient' });
	});

	it('reports a changed shape as invalid, not transient', async () => {
		serve(() => Response.json({ forwards: {}, defensemen: [], goalies: [] }));

		expect(await nhlAdapter.fetchRoster(TOR)).toMatchObject({ ok: false, reason: 'invalid' });
	});

	it('says what went wrong, for the alert', async () => {
		serve(() => Response.json({ forwards: {}, defensemen: [], goalies: [] }));
		const invalid = await nhlAdapter.fetchRoster(TOR);
		expect(!invalid.ok && invalid.detail).toContain('NHL roster TOR schema mismatch');
		expect(!invalid.ok && invalid.detail).toContain('forwards');

		serve(() => new Response('', { status: 503 }));
		const transient = await nhlAdapter.fetchRoster(TOR);
		expect(!transient.ok && transient.detail).toContain('503');

		serve(() => Promise.reject(new Error('socket hang up')));
		const network = await nhlAdapter.fetchRoster(TOR);
		expect(!network.ok && network.detail).toContain('socket hang up');
	});
});

describe('retryAfterMs', () => {
	const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

	it('reads a number of seconds', () => {
		expect(retryAfterMs('120', NOW)).toBe(120_000);
		expect(retryAfterMs(' 0 ', NOW)).toBe(0);
	});

	it('reads an HTTP date as the time left until it', () => {
		expect(retryAfterMs('Sat, 21 Nov 2026 12:00:30 GMT', NOW)).toBe(30_000);
		// Already past: retry now, not a negative wait.
		expect(retryAfterMs('Sat, 21 Nov 2026 11:59:00 GMT', NOW)).toBe(0);
	});

	it('falls back to a minute for a missing or unreadable value', () => {
		expect(retryAfterMs(null, NOW)).toBe(60_000);
		expect(retryAfterMs('', NOW)).toBe(60_000);
		expect(retryAfterMs('soon', NOW)).toBe(60_000);
		expect(retryAfterMs('-5', NOW)).toBe(60_000);
	});
});

describe('nhlAdapter.fetchTeams', () => {
	const standing = (code: string, overrides: Record<string, unknown> = {}) => ({
		teamAbbrev: { default: code },
		teamName: { default: `${code} Name`, fr: `${code} Nom` },
		teamLogo: `https://assets.nhle.com/logos/${code}.svg`,
		...overrides
	});

	it('lists the teams in the standings, sorted by code, with their French names', async () => {
		const urls = serve(() =>
			Response.json({
				standings: [standing('TOR'), standing('BOS', { teamLogo: undefined }), standing('MTL')]
			})
		);

		const teams = await nhlAdapter.fetchTeams();

		expect(urls).toEqual(['https://api-web.nhle.com/v1/standings/now']);
		expect(teams).toEqual([
			{
				code: 'BOS',
				name: 'BOS Name',
				nameFr: 'BOS Nom',
				logoUrl: 'https://assets.nhle.com/logos/nhl/svg/BOS_light.svg'
			},
			{
				code: 'MTL',
				name: 'MTL Name',
				nameFr: 'MTL Nom',
				logoUrl: 'https://assets.nhle.com/logos/MTL.svg'
			},
			{
				code: 'TOR',
				name: 'TOR Name',
				nameFr: 'TOR Nom',
				logoUrl: 'https://assets.nhle.com/logos/TOR.svg'
			}
		]);
		expect(reportError).not.toHaveBeenCalled();
	});

	it.each([
		['the standings request fails', () => new Response('', { status: 500 })],
		['the standings change shape', () => Response.json({ standings: [{ teamAbbrev: 'TOR' }] })],
		['the standings are empty', () => Response.json({ standings: [] })],
		['the network is down', () => Promise.reject(new Error('socket hang up'))]
	])('falls back to the static team list when %s', async (_name, respond) => {
		serve(respond);

		const teams = await nhlAdapter.fetchTeams();

		expect(teams).toHaveLength(32);
		expect(teams.find((t) => t.code === 'TOR')).toEqual({
			code: 'TOR',
			name: 'Toronto Maple Leafs',
			logoUrl: 'https://assets.nhle.com/logos/nhl/svg/TOR_light.svg'
		});
	});

	it('reports the fallback once per fetch, under one fingerprint whatever the cause', async () => {
		serve(() => new Response('', { status: 500 }));
		await nhlAdapter.fetchTeams();
		serve(() => Response.json({ standings: [] }));
		await nhlAdapter.fetchTeams();

		expect(reportError).toHaveBeenCalledTimes(2);
		const [first, second] = reportError.mock.calls.map(([report]) => report);
		// The fingerprint is built from source, message and route, so those must
		// not vary with the cause; the cause travels in the stack.
		expect(first.source).toBe('sync');
		expect(first.route).toBe('sync:teams:nhl');
		expect(second.message).toBe(first.message);
		expect(second.route).toBe(first.route);
		expect(first.stack).toContain('500');
		expect(second.stack).toContain('no teams');
	});
});
