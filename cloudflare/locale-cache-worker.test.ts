import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { MAX_HITS, MAX_HIT_PATH, MAX_HIT_REF, MAX_HIT_UA } from '../src/lib/edge-hits';
import { negotiateLocale } from '../src/lib/i18n';
import { LEAGUE_IDS, resolveLeague } from '../src/lib/leagues';
import worker, {
	bucketLeague,
	bucketLocale,
	cacheKeyUrl,
	canonicalUrl,
	cookieValue,
	isHomePath,
	type Env
} from './locale-cache-worker';

function requestWith(headers: Record<string, string>): Request {
	return new Request('https://numbrrs.app/privacy', { headers });
}

describe('cookieValue', () => {
	it('finds the named cookie among others', () => {
		expect(cookieValue('a=1; numbrrs_locale=fr; b=2', 'numbrrs_locale')).toBe('fr');
	});

	it('is undefined when the cookie is absent', () => {
		expect(cookieValue('a=1; b=2', 'numbrrs_locale')).toBeUndefined();
		expect(cookieValue('', 'numbrrs_locale')).toBeUndefined();
	});
});

describe('bucketLocale', () => {
	it('is always fr under the /fr prefix, regardless of cookie or Accept-Language', () => {
		const request = requestWith({ cookie: 'numbrrs_locale=en', 'accept-language': 'en' });
		expect(bucketLocale('/fr/privacy', request)).toBe('fr');
		expect(bucketLocale('/fr', request)).toBe('fr');
	});

	it('follows an explicit cookie over Accept-Language on an unprefixed path', () => {
		const request = requestWith({
			cookie: 'numbrrs_locale=fr',
			'accept-language': 'en-US,en;q=0.9'
		});
		expect(bucketLocale('/privacy', request)).toBe('fr');
	});

	it('falls back to Accept-Language when there is no cookie', () => {
		const request = requestWith({ 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' });
		expect(bucketLocale('/privacy', request)).toBe('fr');
	});

	it('defaults to en with no cookie and no matching Accept-Language', () => {
		const request = requestWith({});
		expect(bucketLocale('/privacy', request)).toBe('en');
	});

	it('respects q=0 as an explicit refusal, matching negotiateLocale', () => {
		const request = requestWith({ 'accept-language': 'fr;q=0' });
		expect(bucketLocale('/privacy', request)).toBe('en');
	});
});

describe('canonicalUrl', () => {
	const canonical = (url: string) => canonicalUrl(new URL(url)).toString();

	it('drops every query parameter the origin does not read', () => {
		expect(canonical('https://numbrrs.app/game/pwhl/MTL?utm_source=x&fbclid=y&x=1')).toBe(
			'https://numbrrs.app/game/pwhl/MTL'
		);
	});

	it("keeps SvelteKit's data-request parameters, in one order", () => {
		const expected =
			'https://numbrrs.app/game/pwhl/MTL/__data.json?x-sveltekit-invalidated=01&x-sveltekit-trailing-slash=1';
		expect(
			canonical(
				'https://numbrrs.app/game/pwhl/MTL/__data.json?x-sveltekit-trailing-slash=1&utm_source=x&x-sveltekit-invalidated=01'
			)
		).toBe(expected);
		expect(
			canonical(
				'https://numbrrs.app/game/pwhl/MTL/__data.json?x-sveltekit-invalidated=01&x-sveltekit-trailing-slash=1'
			)
		).toBe(expected);
	});

	it('stays on the same host when the path starts with two slashes', () => {
		expect(canonical('https://numbrrs.app//evil.example/game?x=1')).toBe(
			'https://numbrrs.app//evil.example/game'
		);
	});

	it('keeps a league the home page was asked for, ahead of the data parameters', () => {
		expect(canonical('https://numbrrs.app/?utm_source=x&league=pwhl')).toBe(
			'https://numbrrs.app/?league=pwhl'
		);
		expect(canonical('https://numbrrs.app/fr?league=qmjhl&fbclid=y')).toBe(
			'https://numbrrs.app/fr?league=qmjhl'
		);
		expect(canonical('https://numbrrs.app/__data.json?x-sveltekit-invalidated=01&league=ohl')).toBe(
			'https://numbrrs.app/__data.json?league=ohl&x-sveltekit-invalidated=01'
		);
	});

	it.each(['nope', 'PWHL', '', 'pwhl%20', 'nhl,pwhl'])(
		'drops a league that is not one of the known ones: %j',
		(league) => {
			expect(canonical(`https://numbrrs.app/?league=${league}`)).toBe('https://numbrrs.app/');
		}
	);

	it('takes the first league when the parameter is repeated, as the origin does', () => {
		expect(canonical('https://numbrrs.app/?league=whl&league=nhl')).toBe(
			'https://numbrrs.app/?league=whl'
		);
		expect(canonical('https://numbrrs.app/?league=nope&league=nhl')).toBe('https://numbrrs.app/');
	});

	it('drops a league from every page that does not read one', () => {
		expect(canonical('https://numbrrs.app/game/nhl/TOR?league=pwhl')).toBe(
			'https://numbrrs.app/game/nhl/TOR'
		);
		expect(canonical('https://numbrrs.app/privacy?league=pwhl')).toBe(
			'https://numbrrs.app/privacy'
		);
	});
});

describe('isHomePath', () => {
	it.each(['/', '/fr', '/__data.json', '/fr/__data.json'])('is true for %s', (pathname) => {
		expect(isHomePath(pathname)).toBe(true);
	});

	it.each([
		'/privacy',
		'/fr/privacy',
		'/game/nhl/TOR',
		'/fr/game/nhl/TOR/__data.json',
		'/french',
		'/__data.json/x',
		'/api/hit'
	])('is false for %s', (pathname) => {
		expect(isHomePath(pathname)).toBe(false);
	});
});

describe('bucketLeague', () => {
	const league = (url: string, cookie?: string) =>
		bucketLeague(new URL(url), new Request(url, { headers: cookie ? { cookie } : {} }));

	it('takes the league the URL names over the one the cookie remembers', () => {
		expect(league('https://numbrrs.app/?league=pwhl', 'numbrrs_league=ohl')).toBe('pwhl');
	});

	it('falls back to the cookie, then to the default', () => {
		expect(league('https://numbrrs.app/', 'a=1; numbrrs_league=ohl')).toBe('ohl');
		expect(league('https://numbrrs.app/?league=nope', 'numbrrs_league=ohl')).toBe('ohl');
		expect(league('https://numbrrs.app/')).toBe('nhl');
		expect(league('https://numbrrs.app/?league=nope', 'numbrrs_league=also-nope')).toBe('nhl');
	});
});

describe('cacheKeyUrl', () => {
	const key = (url: string, headers: Record<string, string> = {}) =>
		cacheKeyUrl(new URL(url), new Request(url, { headers })).toString();

	it('files the home page under its language and league', () => {
		expect(key('https://numbrrs.app/')).toBe('https://numbrrs.app/?__locale=en&__league=nhl');
		expect(key('https://numbrrs.app/fr', { cookie: 'numbrrs_league=qmjhl' })).toBe(
			'https://numbrrs.app/fr?__locale=fr&__league=qmjhl'
		);
	});

	it('gives a league from the URL and the same league from the cookie one key', () => {
		expect(key('https://numbrrs.app/?league=pwhl')).toBe(
			key('https://numbrrs.app/', { cookie: 'numbrrs_league=pwhl' })
		);
	});

	it('cannot be steered by a visitor naming the key parameters', () => {
		expect(key('https://numbrrs.app/?__league=pwhl&__locale=fr')).toBe(
			'https://numbrrs.app/?__locale=en&__league=nhl'
		);
	});

	it('leaves the league out of every other page, whatever the cookie says', () => {
		expect(
			key('https://numbrrs.app/game/nhl/TOR?league=pwhl', { cookie: 'numbrrs_league=ohl' })
		).toBe('https://numbrrs.app/game/nhl/TOR?__locale=en');
	});

	it('has exactly one key per language per league, whatever is asked for', () => {
		const keys = new Set<string>();
		const leagues = [...LEAGUE_IDS, 'nope', 'NHL', ''];
		for (const path of ['/', '/fr']) {
			for (const language of ['en', 'fr', 'de']) {
				for (const fromUrl of [undefined, ...leagues]) {
					for (const fromCookie of [undefined, ...leagues]) {
						const url = `https://numbrrs.app${path}${fromUrl === undefined ? '' : `?league=${fromUrl}&utm_source=x`}`;
						keys.add(
							key(url, {
								'accept-language': language,
								...(fromCookie === undefined ? {} : { cookie: `numbrrs_league=${fromCookie}` })
							})
						);
					}
				}
			}
		}
		// `/` in English, `/` for a French speaker (the redirect, never stored), and /fr.
		expect(keys.size).toBe(3 * LEAGUE_IDS.length);
	});
});

describe('fetch handler', () => {
	const PAGE_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';
	/** What the zone's Browser Cache TTL leaves on a response served from cache. */
	const REWRITTEN_BY_ZONE = 'public, max-age=14400';

	let stored: Map<string, Response>;
	let putErrors: unknown[];
	let pending: Promise<unknown>[];
	let origin: Mock<(request: Request) => Promise<Response>>;
	/** The origin's /api/hit, which the Worker calls with a URL and options rather than a Request. */
	let hitEndpoint: Mock<(url: string, init: RequestInit) => Promise<Response>>;
	let ctx: { waitUntil: (promise: Promise<unknown>) => void; passThroughOnException: () => void };

	function immutable(response: Response): Response {
		const refuse = () => {
			throw new TypeError("Can't modify immutable headers.");
		};
		Object.defineProperties(response.headers, {
			set: { value: refuse },
			append: { value: refuse },
			delete: { value: refuse }
		});
		return response;
	}

	/**
	 * Stands in for `caches.default` as far as this Worker depends on it: entries
	 * keyed by URL, a `put` that rejects what the real one rejects, and a `match`
	 * that returns an immutable response whose Cache-Control the zone has rewritten.
	 */
	const fakeCache = {
		async match(key: Request): Promise<Response | undefined> {
			const hit = stored.get(key.url);
			if (!hit) return undefined;
			const response = hit.clone();
			response.headers.set('cache-control', REWRITTEN_BY_ZONE);
			response.headers.set('cf-cache-status', 'HIT');
			return immutable(response);
		},
		async put(key: Request, response: Response): Promise<void> {
			if (key.method !== 'GET') throw new TypeError('Cannot cache a non-GET request.');
			if (response.status === 206) throw new TypeError('Cannot cache a 206 response.');
			stored.set(key.url, response);
		}
	};

	function originReturns(
		body: string,
		init: { status?: number; headers?: Record<string, string> } = {}
	) {
		origin.mockImplementation(async () => new Response(body, init));
	}

	async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
		const response = await worker.fetch(new Request(url, { headers }), undefined, ctx);
		// The Worker stores after responding; settle that before the next request,
		// as the gap between two real visitors would.
		await Promise.all(pending.splice(0));
		return response;
	}

	const originUrls = () => origin.mock.calls.map(([request]) => request.url);

	beforeEach(() => {
		stored = new Map();
		putErrors = [];
		pending = [];
		origin = vi.fn<(request: Request) => Promise<Response>>();
		originReturns('<html>page</html>', { headers: { 'cache-control': PAGE_CACHE } });
		hitEndpoint = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
			async () => new Response(null, { status: 204 })
		);
		ctx = {
			waitUntil: (promise) => {
				pending.push(promise.catch((error: unknown) => putErrors.push(error)));
			},
			passThroughOnException: vi.fn()
		};
		vi.stubGlobal('fetch', (input: Request | string, init: RequestInit = {}) =>
			typeof input === 'string' ? hitEndpoint(input, init) : origin(input)
		);
		vi.stubGlobal('caches', { default: fakeCache });
	});

	it('serves the second request for a page from cache', async () => {
		const first = await get('https://numbrrs.app/game/pwhl/MTL');
		const second = await get('https://numbrrs.app/game/pwhl/MTL');

		expect(origin).toHaveBeenCalledTimes(1);
		expect(first.headers.get('cf-cache-status')).toBeNull();
		expect(second.headers.get('cf-cache-status')).toBe('HIT');
		expect(await second.text()).toBe('<html>page</html>');
		expect(putErrors).toEqual([]);
	});

	it('passes anything but a GET straight to the origin, untouched and unstored', async () => {
		const post = new Request('https://numbrrs.app/game/pwhl/MTL?x=1', {
			method: 'POST',
			body: 'guess=1'
		});
		await worker.fetch(post, undefined, ctx);
		const head = new Request('https://numbrrs.app/game/pwhl/MTL', { method: 'HEAD' });
		await worker.fetch(head, undefined, ctx);

		expect(origin.mock.calls[0]?.[0]).toBe(post);
		expect(origin.mock.calls[1]?.[0]).toBe(head);
		expect(pending).toEqual([]);
		expect(stored.size).toBe(0);
		// The runtime's fallback would replay a POST without its body.
		expect(ctx.passThroughOnException).not.toHaveBeenCalled();
	});

	it('asks the runtime to fall back to the origin if handling a GET throws', async () => {
		await get('https://numbrrs.app/game/pwhl/MTL');
		expect(ctx.passThroughOnException).toHaveBeenCalledTimes(1);
	});

	it.each([
		['private, no-store', 'private'],
		['private, no-cache', 'private, by another name'],
		['public, max-age=86400', 'public with no s-maxage'],
		['s-maxage=300', 's-maxage without public'],
		['', 'no Cache-Control at all']
	])('does not store a response marked %j (%s)', async (cacheControl) => {
		originReturns('<html>page</html>', {
			headers: cacheControl ? { 'cache-control': cacheControl } : {}
		});

		await get('https://numbrrs.app/game/pwhl/MTL');
		await get('https://numbrrs.app/game/pwhl/MTL');

		expect(stored.size).toBe(0);
		expect(origin).toHaveBeenCalledTimes(2);
	});

	it.each([
		[404, {}],
		[500, {}],
		[301, { location: '/game/nhl/TOR' }],
		// A range response is `ok`, and the real cache.put throws on one.
		[206, { 'content-range': 'bytes 0-3/17' }]
	])('does not store a %i even when it is marked shareable', async (status, headers) => {
		originReturns('nope', { status, headers: { ...headers, 'cache-control': PAGE_CACHE } });

		const response = await get('https://numbrrs.app/game/pwhl/MTL');
		await get('https://numbrrs.app/game/pwhl/MTL');

		expect(response.status).toBe(status);
		expect(stored.size).toBe(0);
		expect(origin).toHaveBeenCalledTimes(2);
		expect(putErrors).toEqual([]);
	});

	it('keeps a separate entry for each locale on an unprefixed page', async () => {
		origin.mockImplementation(async (request) => {
			const french = request.headers.get('accept-language')?.startsWith('fr');
			return new Response(french ? 'redirect to /fr' : 'english', {
				headers: { 'cache-control': PAGE_CACHE }
			});
		});
		const url = 'https://numbrrs.app/privacy';

		expect(await (await get(url, { 'accept-language': 'en-CA' })).text()).toBe('english');
		expect(await (await get(url, { 'accept-language': 'fr-CA' })).text()).toBe('redirect to /fr');
		expect(origin).toHaveBeenCalledTimes(2);

		// Each visitor now gets their own locale's entry, whoever asked first, and
		// the cookie decides it ahead of Accept-Language.
		expect(await (await get(url, { 'accept-language': 'fr' })).text()).toBe('redirect to /fr');
		expect(await (await get(url, { 'accept-language': 'en' })).text()).toBe('english');
		expect(
			await (await get(url, { 'accept-language': 'fr', cookie: 'numbrrs_locale=en' })).text()
		).toBe('english');
		expect(origin).toHaveBeenCalledTimes(2);
		expect(stored.size).toBe(2);
	});

	it('shares one entry across cookies and languages under the /fr prefix', async () => {
		await get('https://numbrrs.app/fr/privacy', { 'accept-language': 'en' });
		await get('https://numbrrs.app/fr/privacy', { cookie: 'numbrrs_locale=en' });
		await get('https://numbrrs.app/fr/privacy', { 'accept-language': 'fr' });

		expect(origin).toHaveBeenCalledTimes(1);
		expect(stored.size).toBe(1);
	});

	it('serves one entry whatever tracking parameters the link carried', async () => {
		await get('https://numbrrs.app/game/pwhl/MTL?utm_source=newsletter&utm_medium=email');
		await get('https://numbrrs.app/game/pwhl/MTL?fbclid=abc123');
		await get('https://numbrrs.app/game/pwhl/MTL?x=1');
		await get('https://numbrrs.app/game/pwhl/MTL?__locale=fr');
		await get('https://numbrrs.app/game/pwhl/MTL');

		expect(origin).toHaveBeenCalledTimes(1);
		expect(stored.size).toBe(1);
	});

	it("never sends a visitor's own query parameters to the origin", async () => {
		// Stored or not, the response is fetched before the Worker can know which.
		originReturns('', { headers: { 'cache-control': 'private, no-store' } });

		await get('https://numbrrs.app/game/pwhl/MTL?utm_source=newsletter&next=//evil.example');

		expect(originUrls()).toEqual(['https://numbrrs.app/game/pwhl/MTL']);
	});

	it('forwards the request headers the origin negotiates on', async () => {
		await get('https://numbrrs.app/game/pwhl/MTL?utm_source=x', {
			cookie: 'numbrrs_locale=fr',
			'accept-language': 'en'
		});

		const forwarded = origin.mock.calls[0]?.[0];
		expect(forwarded?.headers.get('cookie')).toBe('numbrrs_locale=fr');
		expect(forwarded?.headers.get('accept-language')).toBe('en');
	});

	it("keeps SvelteKit's data-request parameters in the key and in the origin request", async () => {
		const data = 'https://numbrrs.app/game/pwhl/MTL/__data.json';

		await get(`${data}?x-sveltekit-invalidated=01`);
		await get(`${data}?x-sveltekit-invalidated=11`);
		await get(`${data}?x-sveltekit-invalidated=01&x-sveltekit-trailing-slash=1`);
		expect(originUrls()).toEqual([
			`${data}?x-sveltekit-invalidated=01`,
			`${data}?x-sveltekit-invalidated=11`,
			`${data}?x-sveltekit-invalidated=01&x-sveltekit-trailing-slash=1`
		]);
		expect(stored.size).toBe(3);

		// The client copies the page's own query string onto its data requests.
		await get(`${data}?utm_source=x&x-sveltekit-invalidated=11`);
		await get(`${data}?x-sveltekit-trailing-slash=1&x-sveltekit-invalidated=01`);
		expect(origin).toHaveBeenCalledTimes(3);
		expect(stored.size).toBe(3);
	});

	it('does not mix a page up with its data request', async () => {
		await get('https://numbrrs.app/game/pwhl/MTL');
		await get('https://numbrrs.app/game/pwhl/MTL/__data.json?x-sveltekit-invalidated=01');
		await get('https://numbrrs.app/game/pwhl/TOR');

		expect(origin).toHaveBeenCalledTimes(3);
		expect(stored.size).toBe(3);
	});

	it("gives a browser the origin's Cache-Control on a hit, as it got on the miss", async () => {
		const miss = await get('https://numbrrs.app/game/pwhl/MTL');
		const hit = await get('https://numbrrs.app/game/pwhl/MTL');

		expect(miss.headers.get('cache-control')).toBe(PAGE_CACHE);
		expect(hit.headers.get('cf-cache-status')).toBe('HIT');
		expect(hit.headers.get('cache-control')).toBe(PAGE_CACHE);
	});

	it('keeps its bookkeeping header out of what a browser receives', async () => {
		const miss = await get('https://numbrrs.app/game/pwhl/MTL');
		const hit = await get('https://numbrrs.app/game/pwhl/MTL');

		expect(miss.headers.has('x-origin-cache-control')).toBe(false);
		expect(hit.headers.has('x-origin-cache-control')).toBe(false);
	});

	it('returns an entry stored without the original header as the cache gave it', async () => {
		stored.set(
			'https://numbrrs.app/game/pwhl/MTL?__locale=en',
			new Response('older entry', { headers: { 'cache-control': PAGE_CACHE } })
		);

		const hit = await get('https://numbrrs.app/game/pwhl/MTL');

		expect(await hit.text()).toBe('older entry');
		expect(hit.headers.get('cache-control')).toBe(REWRITTEN_BY_ZONE);
		expect(origin).not.toHaveBeenCalled();
	});

	describe('for the home page', () => {
		/**
		 * The origin as far as the home page goes, decided the way hooks.server.ts
		 * and the page's load decide it: a redirect for a French speaker on the
		 * unprefixed URL, otherwise the grid of the league the request resolves to.
		 */
		beforeEach(() => {
			origin.mockImplementation(async (request) => {
				const url = new URL(request.url);
				const cookies = request.headers.get('cookie') ?? '';
				const locale = negotiateLocale(
					cookieValue(cookies, 'numbrrs_locale'),
					request.headers.get('accept-language')
				);
				if (!url.pathname.startsWith('/fr') && locale === 'fr') {
					return new Response(null, {
						status: 302,
						headers: { location: `/fr${url.search}`, 'cache-control': 'private, no-store' }
					});
				}
				const league = resolveLeague(
					url.searchParams.get('league'),
					cookieValue(cookies, 'numbrrs_league')
				);
				return new Response(`${url.pathname} ${league}`, {
					headers: { 'cache-control': PAGE_CACHE }
				});
			});
		});

		const body = async (url: string, headers: Record<string, string> = {}) =>
			(await get(url, headers)).text();

		it('keeps one entry per league, whether the URL or the cookie named it', async () => {
			expect(await body('https://numbrrs.app/')).toBe('/ nhl');
			expect(await body('https://numbrrs.app/', { cookie: 'numbrrs_league=pwhl' })).toBe('/ pwhl');
			expect(origin).toHaveBeenCalledTimes(2);

			expect(await body('https://numbrrs.app/?league=pwhl')).toBe('/ pwhl');
			expect(await body('https://numbrrs.app/', { cookie: 'x=1; numbrrs_league=pwhl' })).toBe(
				'/ pwhl'
			);
			expect(await body('https://numbrrs.app/?fbclid=abc')).toBe('/ nhl');
			expect(await body('https://numbrrs.app/?league=nhl')).toBe('/ nhl');
			expect(origin).toHaveBeenCalledTimes(2);
			expect(stored.size).toBe(2);
		});

		it('serves the league the URL names to a visitor whose cookie says another', async () => {
			await body('https://numbrrs.app/', { cookie: 'numbrrs_league=pwhl' });

			expect(await body('https://numbrrs.app/?league=ohl', { cookie: 'numbrrs_league=pwhl' })).toBe(
				'/ ohl'
			);
			expect(await body('https://numbrrs.app/?league=nhl', { cookie: 'numbrrs_league=pwhl' })).toBe(
				'/ nhl'
			);
			expect(stored.size).toBe(3);
		});

		it('sends the origin a league the visitor named, and nothing else they typed', async () => {
			await get('https://numbrrs.app/?utm_source=x&league=pwhl&next=//evil.example');
			await get('https://numbrrs.app/fr?league=bogus&x=1', { cookie: 'numbrrs_league=ohl' });

			expect(originUrls()).toEqual(['https://numbrrs.app/?league=pwhl', 'https://numbrrs.app/fr']);
			// The cookie still goes along: with no league in the URL it is what the origin reads.
			expect(origin.mock.calls[1]?.[0].headers.get('cookie')).toBe('numbrrs_league=ohl');
		});

		it('makes no new entries for leagues that do not exist', async () => {
			for (const league of ['nope', 'NHL', '', '1', 'pwhl2']) {
				await get(`https://numbrrs.app/?league=${league}`);
				await get('https://numbrrs.app/', { cookie: `numbrrs_league=${league}` });
			}

			expect(origin).toHaveBeenCalledTimes(1);
			expect(stored.size).toBe(1);
		});

		it('never stores the French redirect, nor serves it to an English reader', async () => {
			const french = { 'accept-language': 'fr-CA,fr;q=0.9' };

			const redirect = await get('https://numbrrs.app/', french);
			expect(redirect.status).toBe(302);
			expect(redirect.headers.get('location')).toBe('/fr');
			expect(stored.size).toBe(0);

			expect(await body('https://numbrrs.app/', { 'accept-language': 'en-CA' })).toBe('/ nhl');
			expect(stored.size).toBe(1);

			// With the English page stored: still a redirect for a French speaker,
			// still asked of the origin each time, and the league they named survives.
			const again = await get('https://numbrrs.app/?league=pwhl&utm_source=x', french);
			expect(again.status).toBe(302);
			expect(again.headers.get('location')).toBe('/fr?league=pwhl');
			expect(stored.size).toBe(1);
		});

		it('follows the language cookie over Accept-Language on the unprefixed URL', async () => {
			await body('https://numbrrs.app/');

			// Chose English on the toggle: the stored English page, whatever the browser prefers.
			expect(
				await body('https://numbrrs.app/', {
					'accept-language': 'fr',
					cookie: 'numbrrs_locale=en'
				})
			).toBe('/ nhl');
			expect(origin).toHaveBeenCalledTimes(1);

			// Chose French: the redirect, though the browser asks for English.
			const redirect = await get('https://numbrrs.app/', {
				'accept-language': 'en',
				cookie: 'numbrrs_locale=fr'
			});
			expect(redirect.status).toBe(302);
			expect(stored.size).toBe(1);
		});

		it('shares /fr across languages and cookies, one entry per league', async () => {
			expect(await body('https://numbrrs.app/fr', { cookie: 'numbrrs_locale=en' })).toBe('/fr nhl');
			expect(await body('https://numbrrs.app/fr', { 'accept-language': 'fr' })).toBe('/fr nhl');
			expect(await body('https://numbrrs.app/fr?utm_source=x', { 'accept-language': 'de' })).toBe(
				'/fr nhl'
			);
			expect(origin).toHaveBeenCalledTimes(1);

			expect(await body('https://numbrrs.app/fr?league=qmjhl')).toBe('/fr qmjhl');
			expect(await body('https://numbrrs.app/fr', { cookie: 'numbrrs_league=qmjhl' })).toBe(
				'/fr qmjhl'
			);
			expect(origin).toHaveBeenCalledTimes(2);
			expect(stored.size).toBe(2);
		});

		it('keys the data request by league too, apart from the page', async () => {
			const data = 'https://numbrrs.app/__data.json';

			await get('https://numbrrs.app/', { cookie: 'numbrrs_league=whl' });
			await get(`${data}?x-sveltekit-invalidated=01`, { cookie: 'numbrrs_league=whl' });
			await get(`${data}?x-sveltekit-invalidated=01`);
			expect(originUrls()).toEqual([
				'https://numbrrs.app/',
				`${data}?x-sveltekit-invalidated=01`,
				`${data}?x-sveltekit-invalidated=01`
			]);
			expect(stored.size).toBe(3);

			// The client copies the page's query string onto its data request.
			await get(`${data}?league=whl&x-sveltekit-invalidated=01`);
			await get(`${data}?x-sveltekit-invalidated=01&league=nhl`, { cookie: 'numbrrs_league=whl' });
			expect(origin).toHaveBeenCalledTimes(3);
		});

		it('does not store a home page the origin would not share', async () => {
			// What the origin sends while a league's teams are still missing.
			originReturns('<html>syncing</html>', { headers: { 'cache-control': 'private, no-store' } });

			await get('https://numbrrs.app/');
			await get('https://numbrrs.app/');

			expect(stored.size).toBe(0);
			expect(origin).toHaveBeenCalledTimes(2);
		});
	});

	describe('reporting hits', () => {
		const ENV: Env = { EDGE_TOKEN: 'test-edge-token-not-a-real-secret' };
		const VISITOR = {
			'cf-connecting-ip': '203.0.113.7',
			'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
			referer: 'https://news.example/item?id=1'
		};
		const TEAM_PAGE = 'https://numbrrs.app/game/pwhl/MTL';
		const WAIT = 10_000;

		/**
		 * One request, then just enough turns of the event loop for the Worker to
		 * finish storing the response — without moving the clock, which is what
		 * these tests are about.
		 */
		async function visit(
			url: string,
			headers: Record<string, string> = VISITOR,
			// Wrapped, so that "no bindings" can be passed without becoming the default.
			bindings: { env: Env | undefined } = { env: ENV }
		): Promise<Response> {
			const response = await worker.fetch(new Request(url, { headers }), bindings.env, ctx);
			await vi.advanceTimersByTimeAsync(0);
			return response;
		}

		/** What reached /api/hit, one entry per request. */
		const reports = () =>
			hitEndpoint.mock.calls.map(([url, init]) => ({
				url,
				method: init.method,
				headers: Object.fromEntries(new Headers(init.headers)),
				hits: JSON.parse(String(init.body)) as unknown[]
			}));

		beforeEach(() => {
			vi.useFakeTimers();
		});

		// The queue is the module's, so it outlives a test: let whatever is still
		// waiting go before the next one starts.
		afterEach(async () => {
			await vi.runAllTimersAsync();
			vi.useRealTimers();
		});

		it('reports a hit after the wait, and never a miss', async () => {
			await visit(TEAM_PAGE);
			await vi.advanceTimersByTimeAsync(WAIT * 2);
			expect(hitEndpoint).not.toHaveBeenCalled();

			const hit = await visit(TEAM_PAGE);
			// The visitor has their page; the report has not gone anywhere yet.
			expect(hit.headers.get('cf-cache-status')).toBe('HIT');
			expect(hitEndpoint).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(WAIT - 1);
			expect(hitEndpoint).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);

			expect(reports()).toEqual([
				{
					url: 'https://numbrrs.app/api/hit',
					method: 'POST',
					headers: {
						authorization: 'Bearer test-edge-token-not-a-real-secret',
						'content-type': 'application/json'
					},
					hits: [
						{
							path: '/game/pwhl/MTL',
							ip: '203.0.113.7',
							ua: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
							ref: 'https://news.example/item?id=1'
						}
					]
				}
			]);
			expect(origin).toHaveBeenCalledTimes(1);
			expect(putErrors).toEqual([]);
		});

		it('keeps the secret out of everything but the Authorization header', async () => {
			await visit(TEAM_PAGE);
			await visit(TEAM_PAGE);
			await vi.advanceTimersByTimeAsync(WAIT);

			const [url, init] = hitEndpoint.mock.calls[0]!;
			expect(url).not.toContain(ENV.EDGE_TOKEN);
			expect(String(init.body)).not.toContain(ENV.EDGE_TOKEN);
		});

		it('gathers the hits of one wait into a single request', async () => {
			await visit(TEAM_PAGE);

			await visit(TEAM_PAGE);
			await vi.advanceTimersByTimeAsync(3_000);
			await visit(TEAM_PAGE, { ...VISITOR, 'cf-connecting-ip': '2001:db8::1' });
			await vi.advanceTimersByTimeAsync(6_000);
			await visit(`${TEAM_PAGE}?utm_source=x`, { ...VISITOR, 'cf-connecting-ip': '198.51.100.9' });
			expect(hitEndpoint).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1_000);

			expect(hitEndpoint).toHaveBeenCalledTimes(1);
			expect(reports()[0]?.hits).toMatchObject([
				{ path: '/game/pwhl/MTL', ip: '203.0.113.7' },
				{ path: '/game/pwhl/MTL', ip: '2001:db8::1' },
				// The path alone: what followed `?` is not part of which page it was.
				{ path: '/game/pwhl/MTL', ip: '198.51.100.9' }
			]);

			// And the wait starts again with the next hit.
			await visit(TEAM_PAGE);
			await vi.advanceTimersByTimeAsync(WAIT);
			expect(hitEndpoint).toHaveBeenCalledTimes(2);
			expect(reports()[1]?.hits).toHaveLength(1);
		});

		it('sends a full batch at once and never a larger one', async () => {
			await visit(TEAM_PAGE);

			for (let i = 0; i < MAX_HITS; i++) await visit(TEAM_PAGE);
			expect(hitEndpoint).toHaveBeenCalledTimes(1);
			expect(reports()[0]?.hits).toHaveLength(MAX_HITS);

			// Later hits ride on the wait that was already running.
			await visit(TEAM_PAGE);
			await visit(TEAM_PAGE);
			expect(hitEndpoint).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(WAIT);

			expect(hitEndpoint).toHaveBeenCalledTimes(2);
			expect(reports()[1]?.hits).toHaveLength(2);
		});

		it("reports a page's data request under the path it was asked for", async () => {
			const data = `${TEAM_PAGE}/__data.json?x-sveltekit-invalidated=01`;
			await visit(data);
			await visit(data);
			await visit('https://numbrrs.app/fr');
			await visit('https://numbrrs.app/fr?league=nhl');
			await vi.advanceTimersByTimeAsync(WAIT);

			expect(reports()[0]?.hits).toMatchObject([
				{ path: '/game/pwhl/MTL/__data.json' },
				{ path: '/fr' }
			]);
		});

		it('cuts an overlong user agent and referrer to the size the origin accepts', async () => {
			await visit(TEAM_PAGE);
			await visit(TEAM_PAGE, {
				'cf-connecting-ip': '203.0.113.7',
				'user-agent': 'a'.repeat(MAX_HIT_UA + 100),
				referer: `https://news.example/${'b'.repeat(MAX_HIT_REF)}`
			});
			await vi.advanceTimersByTimeAsync(WAIT);

			const [hit] = reports()[0]?.hits as { ua: string; ref: string }[];
			expect(hit?.ua).toHaveLength(MAX_HIT_UA);
			expect(hit?.ref).toHaveLength(MAX_HIT_REF);
		});

		it('reports a visitor who sent no user agent or referrer, for the origin to judge', async () => {
			await visit(TEAM_PAGE);
			await visit(TEAM_PAGE, { 'cf-connecting-ip': '203.0.113.7' });
			await vi.advanceTimersByTimeAsync(WAIT);

			expect(reports()[0]?.hits).toEqual([
				{ path: '/game/pwhl/MTL', ip: '203.0.113.7', ua: '', ref: null }
			]);
		});

		it.each([
			['no bindings at all', undefined],
			['no secret', {}],
			['an empty secret', { EDGE_TOKEN: '' }]
		])('reports nothing with %s', async (_label, env) => {
			await visit(TEAM_PAGE, VISITOR, { env });
			const hit = await visit(TEAM_PAGE, VISITOR, { env });
			await vi.runAllTimersAsync();

			expect(hit.headers.get('cf-cache-status')).toBe('HIT');
			expect(hitEndpoint).not.toHaveBeenCalled();
		});

		it('reports nothing for a request with no visitor address', async () => {
			const anonymous = { 'user-agent': VISITOR['user-agent'], referer: VISITOR.referer };
			await visit(TEAM_PAGE, anonymous);
			await visit(TEAM_PAGE, anonymous);
			await vi.runAllTimersAsync();

			expect(hitEndpoint).not.toHaveBeenCalled();
		});

		it('reports nothing for a path longer than the origin accepts', async () => {
			const long = `https://numbrrs.app/game/pwhl/${'M'.repeat(MAX_HIT_PATH)}`;
			await visit(long);
			const hit = await visit(long);
			await vi.runAllTimersAsync();

			expect(hit.headers.get('cf-cache-status')).toBe('HIT');
			expect(hitEndpoint).not.toHaveBeenCalled();
		});

		it.each([
			['refuses the report', async () => new Response('Unauthorized', { status: 401 })],
			[
				'cannot be reached',
				async () => {
					throw new TypeError('fetch failed');
				}
			]
		])('carries on when the origin %s, without sending it again', async (_label, outcome) => {
			hitEndpoint.mockImplementationOnce(outcome);
			await visit(TEAM_PAGE);

			await visit(TEAM_PAGE);
			await vi.advanceTimersByTimeAsync(WAIT);
			expect(hitEndpoint).toHaveBeenCalledTimes(1);
			expect(putErrors).toEqual([]);

			await visit(TEAM_PAGE);
			await vi.advanceTimersByTimeAsync(WAIT);
			expect(hitEndpoint).toHaveBeenCalledTimes(2);
			expect(reports()[1]?.hits).toHaveLength(1);
		});

		it('starts a new wait if the one in progress never finished', async () => {
			await visit(TEAM_PAGE);
			await visit(TEAM_PAGE);

			// The request whose timer it was is cut off: the timer never fires.
			vi.clearAllTimers();
			await vi.advanceTimersByTimeAsync(WAIT * 2);
			expect(hitEndpoint).not.toHaveBeenCalled();

			await visit(TEAM_PAGE);
			await vi.advanceTimersByTimeAsync(WAIT);

			expect(hitEndpoint).toHaveBeenCalledTimes(1);
			expect(reports()[0]?.hits).toHaveLength(2);
		});
	});
});
