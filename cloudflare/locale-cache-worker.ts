import { LOCALE_COOKIE, localeFromPath, negotiateLocale, type Locale } from '../src/lib/i18n';

/**
 * Caches locale-dependent pages at the edge without needing Cloudflare's paid
 * vary-by-header cache key.
 *
 * The problem this exists to solve: an unprefixed page (`/privacy`,
 * `/game/<league>/<team>`) can render English or 302 to its `/fr` equivalent,
 * depending on the `numbrrs_locale` cookie and `Accept-Language` (see
 * `negotiateLocale`, imported directly from the app below). Cloudflare's
 * cache key is `(host, path, query)` only — it never varies by cookie, even
 * on the free plan this app runs on. Caching the unprefixed URL naively means
 * the first visitor's outcome (an English render, or a French redirect) gets
 * served to everyone else regardless of what they actually asked for.
 *
 * The fix doesn't touch that decision at all — the origin still owns it
 * entirely, unchanged. This Worker only decides which *cache slot* a request
 * belongs in, by folding the same locale decision into the cache key via the
 * Workers Cache API (`caches.default`), which works on every plan. It also
 * only ever writes to cache when the origin's own response says it's safe to
 * share (`Cache-Control: public` with an `s-maxage`) — `hooks.server.ts`
 * already gets that right per route (home stays `private, no-cache`, `/admin`
 * stays `private, no-store`), so this Worker needs no route list of its own.
 * Requiring a 200 as well is a second line of defence, not the primary one:
 * the origin is meant to mark only real pages as shareable, and an error or a
 * redirect that slipped through with that header still must not be stored.
 *
 * `negotiateLocale` and `localeFromPath` are imported straight from the app
 * rather than re-implemented here — the whole point is that there is nothing
 * to keep in sync by hand. If that logic changes, this file picks it up the
 * next time it's deployed, same as any other importer.
 *
 * Scope: the routes in wrangler.toml attach this to `/privacy` and
 * `/game/*`, each with its `/fr` twin — see docs/hosting.md. `/game/*` takes
 * in the pages' `__data.json` too, which is what client-side navigations
 * between teams fetch; `/privacy` is an exact match, so its `__data.json` has
 * routes of its own.
 *
 * What the Cache API does with the origin's header: `s-maxage` sets how long
 * an entry lives, and `stale-while-revalidate` is ignored — an expired entry
 * is simply a miss, and that visitor waits on the origin. Entries are also
 * per data centre, so each one warms up separately.
 */

/**
 * The only query parameters that change what the origin returns: the two
 * SvelteKit's client adds to a `__data.json` request (`INVALIDATED_PARAM` and
 * `TRAILING_SLASH_PARAM` in @sveltejs/kit's `runtime/shared.js`). The first
 * says which server loads to re-run, so two values really are two responses.
 */
const SVELTEKIT_DATA_PARAMS = ['x-sveltekit-invalidated', 'x-sveltekit-trailing-slash'] as const;

/**
 * Carries the origin's `Cache-Control` through the cache alongside the entry.
 * The zone's Browser Cache TTL raises a lower `max-age` on what Cloudflare
 * serves from cache — it has turned this origin's `max-age=0` into four hours
 * — so the header on an entry handed back by `cache.match` can't be trusted
 * to say what the origin said. A miss is returned exactly as the origin sent
 * it, and restoring the header makes a hit look the same to a browser.
 */
const ORIGIN_CACHE_CONTROL = 'x-origin-cache-control';

export function cookieValue(cookieHeader: string, name: string): string | undefined {
	const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
	return match?.[1];
}

/**
 * `negotiateLocale` is only meaningful for unprefixed URLs — hooks.server.ts
 * only ever calls it when there's no route param, i.e. no /fr prefix. A
 * prefixed URL's content is always that locale regardless of cookie or
 * Accept-Language, so it's returned directly rather than run through
 * negotiation, which would otherwise fragment the cache into two identical
 * copies under different keys.
 */
export function bucketLocale(pathname: string, request: Request): Locale {
	if (localeFromPath(pathname) === 'fr') return 'fr';
	const cookie = cookieValue(request.headers.get('cookie') ?? '', LOCALE_COOKIE);
	return negotiateLocale(cookie, request.headers.get('accept-language'));
}

/**
 * The URL with every query parameter dropped except SvelteKit's own, in a
 * fixed order. No page reads the query string, so `?utm_source=…`, `?fbclid=…`
 * and `?anything=N` all name the same page; keyed on the raw URL, each would
 * be its own cache entry and an endless supply of guaranteed misses.
 */
export function canonicalUrl(url: URL): URL {
	// Cleared in place rather than rebuilt from the pathname: a path starting
	// `//` would parse as a different host if it were resolved against the origin.
	const canonical = new URL(url);
	canonical.search = '';
	canonical.hash = '';
	for (const name of SVELTEKIT_DATA_PARAMS) {
		const value = url.searchParams.get(name);
		if (value !== null) canonical.searchParams.set(name, value);
	}
	return canonical;
}

/**
 * A response from `cache.match` is immutable, so putting the origin's header
 * back means building a new one around the same body.
 */
function withOriginCacheControl(cached: Response): Response {
	const original = cached.headers.get(ORIGIN_CACHE_CONTROL);
	if (original === null) return cached;
	const response = new Response(cached.body, cached);
	response.headers.set('cache-control', original);
	response.headers.delete(ORIGIN_CACHE_CONTROL);
	return response;
}

export default {
	async fetch(
		request: Request,
		_env: unknown,
		ctx: Pick<ExecutionContext, 'waitUntil' | 'passThroughOnException'>
	): Promise<Response> {
		if (request.method !== 'GET') return fetch(request);

		// This Worker is an optimisation in front of an origin that is complete
		// without it, so if anything below throws, the request should go to the
		// origin as though no Worker were attached rather than end in Cloudflare's
		// error page. Armed only after the line above: the fallback re-sends the
		// request, and one whose body was already read would arrive without it.
		ctx.passThroughOnException();

		const url = new URL(request.url);
		const canonical = canonicalUrl(url);

		const cacheKeyUrl = new URL(canonical);
		cacheKeyUrl.searchParams.set('__locale', bucketLocale(url.pathname, request));
		const cacheKey = new Request(cacheKeyUrl.toString(), request);

		const cache = caches.default;
		const cached = await cache.match(cacheKey);
		if (cached) return withOriginCacheControl(cached);

		// The origin is asked for the canonical URL, not the one the visitor sent.
		// The layout renders the query string into the language toggle's link, so
		// a response fetched with the visitor's own parameters would put whatever
		// they typed after `?` into the copy everyone else is served. The cost
		// falls on the French redirect, which the origin builds from the URL it
		// sees: a visitor sent from /game/x?utm_source=… to /fr/game/x arrives
		// without the parameters. Nothing in the app reads them.
		const response = await fetch(new Request(canonical.toString(), request));

		const cacheControl = response.headers.get('cache-control') ?? '';
		if (
			response.status === 200 &&
			cacheControl.includes('public') &&
			cacheControl.includes('s-maxage')
		) {
			const stored = new Response(response.clone().body, response);
			stored.headers.set(ORIGIN_CACHE_CONTROL, cacheControl);
			ctx.waitUntil(cache.put(cacheKey, stored));
		}
		return response;
	}
};
