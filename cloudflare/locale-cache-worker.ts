import { LOCALE_COOKIE, localeFromPath, negotiateLocale, type Locale } from '../src/lib/i18n';

/**
 * Caches locale-dependent HTML at the edge without needing Cloudflare's paid
 * vary-by-header cache key.
 *
 * The problem this exists to solve: an unprefixed page (`/privacy`, and
 * eventually `/game/<league>/<team>`) can render English or 302 to its `/fr`
 * equivalent, depending on the `numbrrs_locale` cookie and `Accept-Language`
 * (see `negotiateLocale`, imported directly from the app below). Cloudflare's
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
 *
 * `negotiateLocale` and `localeFromPath` are imported straight from the app
 * rather than re-implemented here — the whole point is that there is nothing
 * to keep in sync by hand. If that logic changes, this file picks it up the
 * next time it's deployed, same as any other importer.
 *
 * Scope, deliberately narrow for now: the Wrangler route in wrangler.toml
 * only attaches this to /privacy and /fr/privacy — see docs/hosting.md.
 * Expand to /game/<league>/<team> once this has run cleanly for a while.
 */

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

export default {
	async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
		if (request.method !== 'GET') return fetch(request);

		const url = new URL(request.url);
		const cacheKeyUrl = new URL(url);
		cacheKeyUrl.searchParams.set('__locale', bucketLocale(url.pathname, request));
		const cacheKey = new Request(cacheKeyUrl.toString(), request);

		const cache = caches.default;
		const cached = await cache.match(cacheKey);
		if (cached) return cached;

		const response = await fetch(request);
		const cacheControl = response.headers.get('cache-control') ?? '';
		if (response.ok && cacheControl.includes('public') && cacheControl.includes('s-maxage')) {
			ctx.waitUntil(cache.put(cacheKey, response.clone()));
		}
		return response;
	}
};
