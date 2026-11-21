import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import worker, { bucketLocale, canonicalUrl, cookieValue } from './locale-cache-worker';

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
});

describe('fetch handler', () => {
	const PAGE_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';
	/** What the zone's Browser Cache TTL leaves on a response served from cache. */
	const REWRITTEN_BY_ZONE = 'public, max-age=14400';

	let stored: Map<string, Response>;
	let putErrors: unknown[];
	let pending: Promise<unknown>[];
	let origin: Mock<(request: Request) => Promise<Response>>;
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
		ctx = {
			waitUntil: (promise) => {
				pending.push(promise.catch((error: unknown) => putErrors.push(error)));
			},
			passThroughOnException: vi.fn()
		};
		vi.stubGlobal('fetch', origin);
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
		['private, no-cache', 'the home page policy'],
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
});
