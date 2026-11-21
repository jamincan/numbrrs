import {
	HIT_PATH,
	MAX_HITS,
	MAX_HIT_PATH,
	MAX_HIT_REF,
	MAX_HIT_UA,
	type EdgeHit
} from '../src/lib/edge-hits';
import {
	LOCALE_COOKIE,
	localeFromPath,
	localizePath,
	negotiateLocale,
	type Locale
} from '../src/lib/i18n';
import {
	LEAGUE_COOKIE,
	LEAGUE_PARAM,
	isLeagueId,
	resolveLeague,
	type LeagueId
} from '../src/lib/leagues';

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
 * already gets that right per response (`/admin` stays `private, no-store`, and
 * so does a page whose data hasn't arrived yet), so this Worker needs no route
 * list of its own.
 * Requiring a 200 as well is a second line of defence, not the primary one:
 * the origin is meant to mark only real pages as shareable, and an error or a
 * redirect that slipped through with that header still must not be stored.
 *
 * The home page has a second such dependency: which league's grid it renders,
 * decided by a `?league=` in the URL or else the `numbrrs_league` cookie. It is
 * handled the same way, by folding the league into the key, so there is one
 * copy of the home page per language per league and no more.
 *
 * `negotiateLocale`, `localeFromPath` and `resolveLeague` are imported straight
 * from the app rather than re-implemented here — the whole point is that there
 * is nothing to keep in sync by hand. If that logic changes, this file picks it
 * up the next time it's deployed, same as any other importer.
 *
 * Scope: the routes in wrangler.toml attach this to the home page, `/privacy`
 * and `/game/*`, in both languages, along with each page's `__data.json`, which
 * is what a client-side navigation fetches — see the comment there for what
 * the patterns can and can't reach, and docs/hosting.md.
 *
 * A page view is counted as the origin renders the page, so one answered from
 * this cache would not be. Those are reported to the origin instead — see
 * `reportHit` at the bottom.
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

/** What SvelteKit appends to a page's path to ask for its data alone. */
const DATA_SUFFIX = '/__data.json';

/**
 * Whether a path is the home page's, in either language, as the page or as its
 * data request. The home page is the only one that reads the league.
 */
export function isHomePath(pathname: string): boolean {
	const page = pathname.endsWith(DATA_SUFFIX)
		? pathname.slice(0, -DATA_SUFFIX.length) || '/'
		: pathname;
	return localizePath(page, 'en') === '/';
}

/**
 * The league the origin will render the home page for, given this request: the
 * same function it calls, fed the same two things.
 */
export function bucketLeague(url: URL, request: Request): LeagueId {
	return resolveLeague(
		url.searchParams.get(LEAGUE_PARAM),
		cookieValue(request.headers.get('cookie') ?? '', LEAGUE_COOKIE)
	);
}

/**
 * The URL with every query parameter dropped except the ones a page reads, in
 * a fixed order: SvelteKit's own, and on the home page a `league` that names a
 * real one. `?utm_source=…`, `?fbclid=…` and `?anything=N` all name the same
 * page; keyed on the raw URL, each would be its own cache entry and an endless
 * supply of guaranteed misses.
 *
 * A league is kept only if it is one of the known ones, so the origin is never
 * asked for more home pages than there are leagues, whatever a visitor types.
 */
export function canonicalUrl(url: URL): URL {
	// Cleared in place rather than rebuilt from the pathname: a path starting
	// `//` would parse as a different host if it were resolved against the origin.
	const canonical = new URL(url);
	canonical.search = '';
	canonical.hash = '';
	if (isHomePath(url.pathname)) {
		const league = url.searchParams.get(LEAGUE_PARAM);
		if (league !== null && isLeagueId(league)) canonical.searchParams.set(LEAGUE_PARAM, league);
	}
	for (const name of SVELTEKIT_DATA_PARAMS) {
		const value = url.searchParams.get(name);
		if (value !== null) canonical.searchParams.set(name, value);
	}
	return canonical;
}

/**
 * The slot a request's answer is filed under: its canonical URL, plus the
 * language the origin will answer in and, on the home page, the league.
 *
 * The league is in the key once, as the origin will resolve it, and not a
 * second time as the visitor spelled it. `/?league=pwhl` and `/` with the
 * cookie set to pwhl are the same page and share a slot, which is what keeps
 * the home page to one entry per language per league.
 */
export function cacheKeyUrl(url: URL, request: Request): URL {
	const key = canonicalUrl(url);
	key.searchParams.delete(LEAGUE_PARAM);
	key.searchParams.set('__locale', bucketLocale(url.pathname, request));
	if (isHomePath(url.pathname)) key.searchParams.set('__league', bucketLeague(url, request));
	return key;
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

/** `EDGE_TOKEN` is a secret, set with `wrangler secret put` and never in wrangler.toml. */
export interface Env {
	EDGE_TOKEN?: string;
}

type Context = Pick<ExecutionContext, 'waitUntil' | 'passThroughOnException'>;

export default {
	async fetch(request: Request, env: Env | undefined, ctx: Context): Promise<Response> {
		if (request.method !== 'GET') return fetch(request);

		// This Worker is an optimisation in front of an origin that is complete
		// without it, so if anything below throws, the request should go to the
		// origin as though no Worker were attached rather than end in Cloudflare's
		// error page. Armed only after the line above: the fallback re-sends the
		// request, and one whose body was already read would arrive without it.
		ctx.passThroughOnException();

		const url = new URL(request.url);
		const cacheKey = new Request(cacheKeyUrl(url, request).toString(), request);

		const cache = caches.default;
		const cached = await cache.match(cacheKey);
		if (cached) {
			try {
				reportHit(request, url, env, ctx);
			} catch {
				// Counting a view is never a reason to lose the cached page: thrown
				// from here, an error would send the request on to the origin.
			}
			return withOriginCacheControl(cached);
		}

		// The origin is asked for the canonical URL, not the one the visitor sent.
		// The layout renders the query string into the language toggle's link, so
		// a response fetched with the visitor's own parameters would put whatever
		// they typed after `?` into the copy everyone else is served. The cost
		// falls on the French redirect, which the origin builds from the URL it
		// sees: a visitor sent from /game/x?utm_source=… to /fr/game/x arrives
		// without the parameters. Nothing in the app reads them.
		//
		// A league the visitor named does go along, since the origin has to see
		// it to render that league, and so it can end up in that link: the home
		// page for a league is stored from whichever request missed first,
		// `/?league=pwhl` or `/` with the cookie. Both are the same page, and the
		// link is one a browser running the page's script puts right for the
		// address it is actually on.
		const response = await fetch(new Request(canonicalUrl(url).toString(), request));

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

/**
 * Reporting the views this cache answers.
 *
 * The origin counts a page view as it renders the page, so a miss is counted
 * there, in passing, and a hit is not counted at all — and hits are most of
 * the traffic on exactly the day anyone wants the numbers. So each hit is
 * reported to the origin after the visitor has been answered: the page asked
 * for and the three things the origin would have read off the request itself
 * (the visitor's address as Cloudflare saw it, their user agent, their
 * referrer). The origin works out the rest, including whether it was a bot;
 * see src/routes/api/hit/+server.ts.
 *
 * Only hits are reported. A request this Worker passes to the origin is
 * counted by the origin, and reporting it too would count it twice. A page's
 * data request is reported like the page, because the origin counts one as a
 * view too: it is what a client-side navigation looks like from here.
 *
 * Reports are gathered and sent together rather than one per view. The origin
 * is a single small machine with room for 25 connections, and a report per
 * hit would hand it one request for every view the cache had just spared it —
 * a cheap one, but arriving at the full rate of the spike. A batch goes when
 * it is full, or ten seconds after its first report, whichever comes first.
 * The price is that the queue lives in this isolate's memory: when Cloudflare
 * retires an isolate, the reports it was holding (at most one batch, at most
 * ten seconds' worth) are lost, and a batch that fails to send is not sent
 * again. The counts come out slightly low, never high, which is the right way
 * round for a number nobody is billed on.
 */

/**
 * How long a report waits for company. Well inside the thirty seconds
 * `waitUntil` may keep a request's work alive after its response.
 */
const FLUSH_AFTER_MS = 10_000;

/**
 * How overdue a flush has to be before it is taken for lost. The timer belongs
 * to the request that started it, and if that request's work is cut off the
 * timer never fires; without this, nothing would start another.
 */
const FLUSH_GRACE_MS = 5_000;

/** Module scope is per isolate: every request the isolate handles shares these. */
const queue: EdgeHit[] = [];
let flushDueAt = 0;

/** Sends what has gathered. Never throws: this is bookkeeping, done after the visitor was answered. */
async function sendQueued(endpoint: string, token: string): Promise<void> {
	const batch = queue.splice(0, MAX_HITS);
	if (batch.length === 0) return;
	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(batch)
		});
		// Whatever the origin answered, nobody is going to read it.
		await response.body?.cancel();
	} catch {
		// The origin is restarting or unreachable. The batch is gone; keeping it
		// to try again would let the queue grow for as long as that lasts.
	}
}

function reportHit(request: Request, url: URL, env: Env | undefined, ctx: Context): void {
	// Without the secret the origin would refuse the report, so none is made.
	const token = env?.EDGE_TOKEN;
	if (!token) return;

	// Cloudflare puts this on every request it hands a Worker. Without it there
	// is no visitor to count the view against.
	const ip = request.headers.get('cf-connecting-ip');
	if (!ip || url.pathname.length > MAX_HIT_PATH) return;

	queue.push({
		path: url.pathname,
		ip,
		ua: (request.headers.get('user-agent') ?? '').slice(0, MAX_HIT_UA),
		ref: request.headers.get('referer')?.slice(0, MAX_HIT_REF) ?? null
	});

	// The same host this request came in on. A Worker's request to its own zone
	// goes to the origin without passing through a Worker route again.
	const endpoint = new URL(HIT_PATH, url.origin).toString();

	if (queue.length >= MAX_HITS) {
		ctx.waitUntil(sendQueued(endpoint, token));
		return;
	}

	const now = Date.now();
	if (flushDueAt !== 0 && now < flushDueAt + FLUSH_GRACE_MS) return;

	flushDueAt = now + FLUSH_AFTER_MS;
	ctx.waitUntil(
		new Promise<void>((resolve) => setTimeout(resolve, FLUSH_AFTER_MS)).then(() => {
			flushDueAt = 0;
			return sendQueued(endpoint, token);
		})
	);
}
