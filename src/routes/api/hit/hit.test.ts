import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { MAX_HITS, MAX_HIT_REF, MAX_HIT_UA } from '#lib/edge-hits.ts';
import { recordEvent } from '#lib/server/analytics.ts';
import { getDb, initDb } from '#lib/server/db/index.ts';
import { events } from '#lib/server/db/schema.ts';

const TOKEN = 'unit-test-edge-token-0123456789abcdef-not-a-real-secret';

const env = vi.hoisted(() => ({ edgeToken: undefined as string | undefined }));

vi.mock('$app/env/private', () => ({
	ALERT_WEBHOOK_URL: undefined,
	ADMIN_TOKEN: undefined,
	ADMIN_DIRECT: false,
	get EDGE_TOKEN() {
		return env.edgeToken;
	},
	DATABASE_URL: ':memory:'
}));

// The real `match` asks SvelteKit's router, which exists only inside a running
// server. This stands in for it with the app's own routes, so what is tested
// here is what the endpoint does with the router's answer; that the real one
// answers the same for these paths is checked against a running server.
vi.mock('$app/paths', () => ({
	match: async (url: URL) => {
		const path = url.pathname;
		const home = /^\/(?:(fr))?$/.exec(path) ?? /^\/(fr)\/$/.exec(path);
		if (home) return { id: '/[[lang=locale]]', params: home[1] ? { lang: 'fr' } : {} };
		const privacy = /^\/(?:(fr)\/)?privacy$/.exec(path);
		if (privacy) {
			return { id: '/[[lang=locale]]/privacy', params: privacy[1] ? { lang: 'fr' } : {} };
		}
		const team = /^\/(?:(fr)\/)?game\/([^/]+)\/([^/]+)$/.exec(path);
		if (team) {
			return {
				id: '/[[lang=locale]]/game/[league]/[team]',
				params: { ...(team[1] ? { lang: 'fr' } : {}), league: team[2], team: team[3] }
			};
		}
		if (path === '/api/health') return { id: '/api/health', params: {} };
		if (path === '/admin') return { id: '/admin', params: {} };
		if (path === '/sitemap.xml') return { id: '/sitemap.xml', params: {} };
		return null;
	}
}));

const { POST } = await import('./+server');

const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';
const VISITOR_IP = '203.0.113.7';

function hit(overrides: Record<string, unknown> = {}) {
	return { path: '/game/nhl/TOR', ip: VISITOR_IP, ua: BROWSER, ref: null, ...overrides };
}

interface SendOptions {
	authorization?: string | null;
	headers?: Record<string, string>;
}

async function send(body: unknown, options: SendOptions = {}): Promise<Response> {
	const { authorization = `Bearer ${TOKEN}`, headers = {} } = options;
	const url = new URL('https://numbrrs.app/api/hit');
	const request = new Request(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(authorization === null ? {} : { authorization }),
			...headers
		},
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return POST({ request, url } as unknown as Parameters<typeof POST>[0]);
}

function recorded() {
	return getDb().select().from(events).orderBy(events.id).all();
}

/**
 * The request the origin would have seen had it served the page itself: through
 * Cloudflare, for the canonical host, with the visitor's address in the header
 * Cloudflare writes. The first address is one of Cloudflare's own, which is
 * what makes `clientIp` believe the second.
 */
function renderedView(
	path: string,
	route: { id: string; params: Record<string, string> },
	visitor: { ip: string; ua: string; ref?: string }
): RequestEvent {
	const url = new URL(`https://numbrrs.app${path}`);
	return {
		url,
		route: { id: route.id },
		params: route.params,
		locals: { locale: route.params.lang === 'fr' ? 'fr' : 'en' },
		request: new Request(url, {
			headers: {
				'fly-client-ip': '173.245.48.1',
				'cf-connecting-ip': visitor.ip,
				'user-agent': visitor.ua,
				...(visitor.ref ? { referer: visitor.ref } : {})
			}
		})
	} as unknown as RequestEvent;
}

beforeEach(() => {
	initDb(new Database(':memory:'));
	env.edgeToken = TOKEN;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('POST /api/hit', () => {
	describe('who may report', () => {
		it('records a report that carries the secret, and answers 204 with nothing', async () => {
			const response = await send([hit()]);

			expect(response.status).toBe(204);
			expect(response.body).toBeNull();
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect(recorded()).toHaveLength(1);
		});

		it.each([
			['no Authorization header', null],
			['an empty one', ''],
			['the wrong secret', `Bearer ${TOKEN.slice(0, -1)}x`],
			['a secret that is only the start of the right one', `Bearer ${TOKEN.slice(0, 20)}`],
			['the right secret with more after it', `Bearer ${TOKEN}0`],
			['the secret with no scheme', TOKEN],
			['another scheme', `Basic ${TOKEN}`],
			['a scheme and nothing else', 'Bearer '],
			['an empty secret', 'Bearer']
		])('refuses %s without reading the report', async (_label, authorization) => {
			const url = new URL('https://numbrrs.app/api/hit');
			const request = new Request(url, {
				method: 'POST',
				headers: authorization === null ? {} : { authorization },
				body: JSON.stringify([hit()])
			});

			const response = await POST({ request, url } as unknown as Parameters<typeof POST>[0]);

			expect(response.status).toBe(401);
			expect(response.body).toBeNull();
			expect(request.bodyUsed).toBe(false);
			expect(recorded()).toEqual([]);
		});

		it.each([
			['unset', undefined],
			['blank', '']
		])('refuses every report while the origin has its secret %s', async (_label, configured) => {
			env.edgeToken = configured;

			expect((await send([hit()])).status).toBe(401);
			expect((await send([hit()], { authorization: 'Bearer ' })).status).toBe(401);
			expect((await send([hit()], { authorization: 'Bearer undefined' })).status).toBe(401);
			expect((await send([hit()], { authorization: null })).status).toBe(401);
			expect(recorded()).toEqual([]);
		});

		it('takes the scheme in any case, as HTTP does', async () => {
			expect((await send([hit()], { authorization: `bearer ${TOKEN}` })).status).toBe(204);
			expect(recorded()).toHaveLength(1);
		});

		it('never writes the secret to the log', async () => {
			await send([hit()]);
			await send([hit()], { authorization: `Bearer ${TOKEN}x` });
			await send('{not json');

			for (const method of [console.error, console.warn, console.log]) {
				for (const call of vi.mocked(method).mock.calls) {
					expect(call.map(String).join(' ')).not.toContain(TOKEN);
				}
			}
		});
	});

	describe('what a report becomes', () => {
		it('writes the row a rendered view of the same page writes', async () => {
			const visitor = { ip: VISITOR_IP, ua: BROWSER, ref: 'https://news.example/item?id=1' };

			recordEvent(
				renderedView(
					'/fr/game/pwhl/MTL',
					{
						id: '/[[lang=locale]]/game/[league]/[team]',
						params: { lang: 'fr', league: 'pwhl', team: 'MTL' }
					},
					visitor
				),
				{ name: 'pageview' }
			);
			await send([hit({ path: '/fr/game/pwhl/MTL', ...visitor })]);

			const [rendered, reported] = recorded();
			expect(reported).toEqual({ ...rendered, id: reported?.id, at: reported?.at });
			expect(reported).toMatchObject({
				name: 'pageview',
				path: '/fr/game/pwhl/MTL',
				routeId: '/[[lang=locale]]/game/[league]/[team]',
				league: 'pwhl',
				team: 'MTL',
				locale: 'fr',
				referrerHost: 'news.example',
				props: null
			});
			expect(reported?.visitorHash).toMatch(/^[0-9a-f]{16}$/);
		});

		it('counts the same visitor as one, and another as another', async () => {
			await send([
				hit(),
				hit({ path: '/privacy' }),
				hit({ ip: '203.0.113.8' }),
				hit({ ua: `${BROWSER} Edg/140` })
			]);

			const hashes = recorded().map((row) => row.visitorHash);
			expect(hashes[1]).toBe(hashes[0]);
			expect(new Set(hashes).size).toBe(3);
		});

		it('folds an IPv6 visitor to their /64, as a rendered view does', async () => {
			recordEvent(
				renderedView(
					'/',
					{ id: '/[[lang=locale]]', params: {} },
					{ ip: '2001:db8:1:2:aaaa::1', ua: BROWSER }
				),
				{ name: 'pageview' }
			);
			await send([hit({ path: '/', ip: '2001:db8:1:2:bbbb::2' })]);
			await send([hit({ path: '/', ip: '2001:db8:1:3::1' })]);

			const [rendered, sameBlock, otherBlock] = recorded().map((row) => row.visitorHash);
			expect(sameBlock).toBe(rendered);
			expect(otherBlock).not.toBe(rendered);
		});

		it('stores the address nowhere', async () => {
			await send([hit({ ip: VISITOR_IP }), hit({ path: '/', ip: '2001:db8:1:2:aaaa::1' })]);

			const everything = JSON.stringify(getDb().select().from(events).all());
			expect(recorded()).toHaveLength(2);
			expect(everything).not.toContain(VISITOR_IP);
			expect(everything).not.toContain('2001:db8');
			// Nor the things only the hash is made from.
			expect(everything).not.toContain('Firefox');
		});

		it.each([
			['/', '/', '/[[lang=locale]]', 'en'],
			['/fr', '/fr', '/[[lang=locale]]', 'fr'],
			['/__data.json', '/', '/[[lang=locale]]', 'en'],
			['/fr/__data.json', '/fr', '/[[lang=locale]]', 'fr'],
			['/privacy/__data.json', '/privacy', '/[[lang=locale]]/privacy', 'en'],
			[
				'/fr/game/nhl/TOR/__data.json',
				'/fr/game/nhl/TOR',
				'/[[lang=locale]]/game/[league]/[team]',
				'fr'
			]
		])('records %s as a view of %s', async (reportedPath, path, routeId, locale) => {
			await send([hit({ path: reportedPath })]);

			expect(recorded()).toMatchObject([{ path, routeId, locale }]);
		});

		it('normalises the league and team the way a rendered view is', async () => {
			await send([hit({ path: '/game/NHL/tor' })]);

			expect(recorded()).toMatchObject([{ path: '/game/NHL/tor', league: 'nhl', team: 'TOR' }]);
		});

		it('leaves the league and team empty on a page that has neither', async () => {
			await send([hit({ path: '/privacy' })]);

			expect(recorded()).toMatchObject([{ league: null, team: null }]);
		});

		it.each([
			[
				'a search engine',
				'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
			],
			['a script', 'curl/8.5.0'],
			['nothing at all', '']
		])('does not count a view whose user agent is %s', async (_label, ua) => {
			const response = await send([hit({ ua }), hit()]);

			expect(response.status).toBe(204);
			expect(recorded()).toHaveLength(1);
		});

		it.each([
			['its own host', 'https://numbrrs.app/game/nhl/TOR', null],
			['a host that redirects here', 'https://www.numbrrs.app/', null],
			['another site', 'https://www.reddit.com/r/hockey/comments/abc', 'www.reddit.com'],
			['something that is not a URL', 'android-app', null],
			['nothing', null, null]
		])('keeps only the host of a referrer from %s', async (_label, ref, referrerHost) => {
			await send([hit({ ref })]);

			expect(recorded()).toMatchObject([{ referrerHost }]);
		});

		it('still counts a view whose referrer is the wrong shape', async () => {
			await send([
				hit({ ref: 42 }),
				hit({ ref: 'x'.repeat(MAX_HIT_REF + 1) }),
				{ ...hit(), ref: undefined }
			]);

			expect(recorded()).toMatchObject([
				{ referrerHost: null },
				{ referrerHost: null },
				{ referrerHost: null }
			]);
		});
	});

	describe('what it will not count', () => {
		it.each([
			['a path that matches no route', hit({ path: '/wp-login.php' })],
			['a route that is not a page', hit({ path: '/api/health' })],
			['the admin page', hit({ path: '/admin' })],
			['the sitemap', hit({ path: '/sitemap.xml' })],
			['a path with no leading slash', hit({ path: 'game/nhl/TOR' })],
			['a path naming another host', hit({ path: '//evil.example/' })],
			['an address that is not one', hit({ ip: 'not-an-address' })],
			['an empty address', hit({ ip: '' })],
			['an address with something after it', hit({ ip: `${VISITOR_IP}, 10.0.0.1` })],
			['no address', { path: '/', ua: BROWSER, ref: null }],
			['no user agent', { path: '/', ip: VISITOR_IP, ref: null }],
			['no path', { ip: VISITOR_IP, ua: BROWSER, ref: null }],
			['a user agent past the cap', hit({ ua: 'a'.repeat(MAX_HIT_UA + 1) })],
			['a path past the cap', hit({ path: `/${'a'.repeat(700)}` })],
			['fields of the wrong type', { path: 1, ip: 2, ua: 3, ref: 4 }],
			['null', null],
			['a string', 'hit'],
			['a nested list', [hit()]]
		])('drops %s and keeps the rest of the batch', async (_label, bad) => {
			const response = await send([hit({ path: '/' }), bad, hit({ path: '/privacy' })]);

			expect(response.status).toBe(204);
			expect(recorded().map((row) => row.path)).toEqual(['/', '/privacy']);
		});

		it('answers 204 to an empty batch and writes nothing', async () => {
			expect((await send([])).status).toBe(204);
			expect(recorded()).toEqual([]);
		});

		it.each([
			['not JSON', '{not json'],
			['an empty body', ''],
			['a single report outside a list', JSON.stringify(hit())],
			['null', 'null'],
			['a number', '7']
		])('refuses a body that is %s', async (_label, body) => {
			const response = await send(body);

			expect(response.status).toBe(400);
			expect(response.body).toBeNull();
			expect(recorded()).toEqual([]);
		});

		it('takes a full batch and refuses a larger one whole', async () => {
			const full = Array.from({ length: MAX_HITS }, (_, i) => hit({ ip: `198.51.100.${i + 1}` }));

			expect((await send(full)).status).toBe(204);
			expect(recorded()).toHaveLength(MAX_HITS);

			expect((await send([...full, hit()])).status).toBe(400);
			expect(recorded()).toHaveLength(MAX_HITS);
		});

		it('has room for a full batch of the longest reports the Worker sends', async () => {
			const longest = Array.from({ length: MAX_HITS }, (_, i) =>
				hit({
					ip: `2001:db8:${i}:ffff:ffff:ffff:ffff:ffff`,
					// Every character one JSON has to escape, which doubles it.
					ua: `Mozilla/5.0 ${'"'.repeat(MAX_HIT_UA - 12)}`,
					ref: `https://news.example/${'\\'.repeat(MAX_HIT_REF - 21)}`
				})
			);

			expect((await send(longest)).status).toBe(204);
			expect(recorded()).toHaveLength(MAX_HITS);
		});

		it('refuses an oversized body by its declared length, before reading it', async () => {
			const url = new URL('https://numbrrs.app/api/hit');
			const request = new Request(url, {
				method: 'POST',
				headers: { authorization: `Bearer ${TOKEN}`, 'content-length': String(1024 * 1024) },
				body: '[]'
			});

			const response = await POST({ request, url } as unknown as Parameters<typeof POST>[0]);

			expect(response.status).toBe(413);
			expect(request.bodyUsed).toBe(false);
		});

		it('refuses an oversized body that did not declare its length', async () => {
			const response = await send(`[${' '.repeat(200 * 1024)}]`);

			expect(response.status).toBe(413);
			expect(recorded()).toEqual([]);
		});
	});

	it('trusts nothing about the request that carried the report', async () => {
		// Cloudflare's address and the Worker's own headers describe the reporter.
		await send([hit({ ref: 'https://news.example/' })], {
			headers: {
				'fly-client-ip': '173.245.48.1',
				'cf-connecting-ip': '198.51.100.200',
				'user-agent': 'Googlebot/2.1',
				referer: 'https://elsewhere.example/'
			}
		});
		recordEvent(
			renderedView(
				'/game/nhl/TOR',
				{ id: '/[[lang=locale]]/game/[league]/[team]', params: { league: 'nhl', team: 'TOR' } },
				{ ip: VISITOR_IP, ua: BROWSER }
			),
			{ name: 'pageview' }
		);

		const [reported, rendered] = recorded();
		expect(reported?.referrerHost).toBe('news.example');
		expect(reported?.visitorHash).toBe(rendered?.visitorHash);
	});
});
