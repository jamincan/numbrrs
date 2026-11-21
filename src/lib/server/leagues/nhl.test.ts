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

	describe('content limits', () => {
		const name = (first: string, last: string) => ({
			firstName: { default: first },
			lastName: { default: last }
		});

		async function rosterOf(...forwards: unknown[]) {
			serve(() => Response.json({ forwards, defensemen: [], goalies: [] }));
			const result = await nhlAdapter.fetchRoster(TOR);
			if (!result.ok) throw new Error(`roster failed: ${result.reason}`);
			return result.players;
		}

		it('keeps names of the lengths and characters the leagues really publish', async () => {
			// The longest first and last names across all five leagues, and one of
			// each kind of punctuation and accent found in them.
			const real: [string, string][] = [
				['Charle-Edouard', "D'Astous"],
				['Emile-Alexandro', 'Morrissette-Richer'],
				['Adam', 'Gustafsson Nyberg'],
				["K'Andre", 'Miller'],
				['J.T.', 'St. Ivany'],
				['Paulo', 'Gualberto Jr.'],
				['Élizabeth', 'Nylén Persson'],
				['Louis-François', 'Šťřžčěýï'],
				['Liam', 'O’Brien']
			];

			const players = await rosterOf(...real.map(([f, l], i) => player(i + 1, name(f, l))));

			expect(players.map((p) => [p.firstName, p.lastName])).toEqual(real);
		});

		it('drops a player with a name past the cap, and keeps one exactly at it', async () => {
			const players = await rosterOf(
				player(1, name('A'.repeat(64), 'B'.repeat(64))),
				player(2, name('A'.repeat(65), 'Fine')),
				player(3, name('Fine', 'B'.repeat(65))),
				player(4)
			);

			expect(players.map((p) => p.id)).toEqual([1, 4]);
			expect(console.warn).toHaveBeenCalledWith('NHL roster TOR: skipped 2 unreadable entries');
		});

		it('drops a player whose id is not a positive integer in range', async () => {
			const players = await rosterOf(
				player(0),
				player(-7),
				player(1.5),
				player(1_000_000_000),
				player(999_999_999),
				player(8_486_166)
			);

			expect(players.map((p) => p.id)).toEqual([999_999_999, 8_486_166]);
		});

		it('drops a player whose position is not a short code, but allows an empty one', async () => {
			const players = await rosterOf(
				player(1, { positionCode: '' }),
				player(2, { positionCode: 'DEFENSEMAN' }),
				player(3, { positionCode: 'LW' })
			);

			expect(players.map((p) => [p.id, p.positionCode])).toEqual([
				[1, ''],
				[3, 'LW']
			]);
		});

		it('keeps a player whose headshot is unusable, without the headshot', async () => {
			const players = await rosterOf(
				player(1, { headshot: 'http://assets.nhle.com/mugs/1.png' }),
				player(2, { headshot: 'javascript:alert(1)' }),
				player(3, { headshot: `https://assets.nhle.com/${'x'.repeat(500)}` }),
				player(4, { headshot: 'https://assets.nhle.com/mugs/4 .png' }),
				// Any host, as long as it is https: a league may move its images.
				player(5, { headshot: 'https://cdn.example.net/mugs/5.png' }),
				player(6, { headshot: `https://assets.nhle.com/${'x'.repeat(512 - 24)}` })
			);

			expect(players.map((p) => p.headshotUrl)).toEqual([
				'',
				'',
				'',
				'',
				'https://cdn.example.net/mugs/5.png',
				`https://assets.nhle.com/${'x'.repeat(512 - 24)}`
			]);
		});

		it('keeps a player whose number no sweater carries, without the number', async () => {
			const players = await rosterOf(
				player(1, { sweaterNumber: 0 }),
				player(2, { sweaterNumber: 99 }),
				player(3, { sweaterNumber: 100 }),
				player(4, { sweaterNumber: 999 }),
				player(5, { sweaterNumber: -1 }),
				player(6, { sweaterNumber: 34.5 })
			);

			expect(players.map((p) => p.sweaterNumber)).toEqual([0, 99, null, null, null, null]);
		});

		it('still drops a player whose number has changed type', async () => {
			// Kept without a number, a feed that started sending every number as a
			// string would empty the game without anything failing.
			const players = await rosterOf(player(1, { sweaterNumber: '34' }), player(2));

			expect(players.map((p) => p.id)).toEqual([2]);
		});
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

	// A team can't be skipped the way a player can: a team missing from the list
	// is deleted. So one unusable row fails the live list as a whole, and the
	// static list — always all 32, so never a shrunken league — takes over.
	it.each([
		['is lowercase', standing('tor')],
		['has punctuation in it', standing('T/R')],
		['is a single character', standing('T')],
		['is longer than eight characters', standing('TORONTOML')],
		['is empty', standing('')],
		['comes with a name past the cap', standing('TOR', { teamName: { default: 'T'.repeat(81) } })],
		[
			'comes with a French name past the cap',
			standing('TOR', { teamName: { default: 'Toronto', fr: 'T'.repeat(81) } })
		]
	])('falls back to the static team list when a team code %s', async (_name, bad) => {
		serve(() => Response.json({ standings: [standing('BOS'), bad, standing('MTL')] }));

		const teams = await nhlAdapter.fetchTeams();

		expect(teams).toHaveLength(32);
		expect(teams.map((t) => t.code)).toContain('TOR');
		expect(reportError).toHaveBeenCalledTimes(1);
		expect(reportError.mock.calls[0]?.[0].stack).toContain('NHL standings schema mismatch');
	});

	it('accepts codes and names at the edges of what is allowed', async () => {
		serve(() =>
			Response.json({
				standings: [
					standing('NY'),
					standing('ABCD1234'),
					standing('MTL', {
						teamName: { default: 'N'.repeat(80), fr: 'Canadiens de Montréal' }
					})
				]
			})
		);

		const teams = await nhlAdapter.fetchTeams();

		expect(teams.map((t) => t.code)).toEqual(['ABCD1234', 'MTL', 'NY']);
		expect(teams[1]?.name).toHaveLength(80);
		expect(reportError).not.toHaveBeenCalled();
	});

	it('builds the logo address itself when the feed’s is unusable', async () => {
		serve(() =>
			Response.json({
				standings: [
					standing('TOR', { teamLogo: 'http://assets.nhle.com/logos/TOR.svg' }),
					standing('BOS', { teamLogo: 'https://cdn.example.net/logos/BOS.svg' })
				]
			})
		);

		const teams = await nhlAdapter.fetchTeams();

		expect(teams.map((t) => t.logoUrl)).toEqual([
			'https://cdn.example.net/logos/BOS.svg',
			'https://assets.nhle.com/logos/nhl/svg/TOR_light.svg'
		]);
	});
});
