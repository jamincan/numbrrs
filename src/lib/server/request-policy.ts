import { isIP } from 'node:net';
import { negotiateLocale } from '#lib/i18n/index.ts';
import { FLY_HOSTNAME, REDIRECT_HOSTNAMES, SITE_ORIGIN } from '#lib/site.ts';

/**
 * Every decision `handle` makes about a request, as functions of plain values:
 * no database, no environment, no clock. hooks.server.ts gathers the inputs and
 * acts on the answers, which leaves the rules themselves testable without
 * booting anything.
 */

/** Whether a path is part of the admin area, its data requests included. */
export function isAdminPath(pathname: string): boolean {
	return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * The path as SvelteKit's router reads it. Kept in step with `decode_pathname`
 * in the framework: everything but %25 is decoded, so `/%61dmin` is `/admin` by
 * the time a route is chosen. A sequence that can't be decoded matches no route
 * (SvelteKit answers 400), so the raw text is the right fallback.
 */
function routedPath(pathname: string): string {
	try {
		return pathname.split('%25').map(decodeURI).join('%25');
	} catch {
		return pathname;
	}
}

/**
 * Whether a request is for the admin area.
 *
 * The route SvelteKit matched is the authority: it is what decides which code
 * runs, and it is chosen from the decoded path, so a check on the raw path
 * alone is walked around by percent-encoding one letter. The path is still
 * consulted, because a URL under /admin that matches no route has no route id,
 * and that should be refused like the rest rather than answered with a 404
 * that maps out what exists.
 *
 * Remote functions are not routed, so one would not be covered by this.
 */
export function isAdminRequest(routeId: string | null, pathname: string): boolean {
	if (routeId !== null && isAdminPath(routeId)) return true;
	return isAdminPath(pathname) || isAdminPath(routedPath(pathname));
}

/**
 * Whether a request has to show a Cloudflare Access token. Dev has no Access in
 * front of it, and `adminDirect` is the way in while Cloudflare is down.
 */
export function requiresAccess(request: {
	routeId: string | null;
	pathname: string;
	dev: boolean;
	adminDirect: boolean;
}): boolean {
	if (request.dev || request.adminDirect) return false;
	return isAdminRequest(request.routeId, request.pathname);
}

/**
 * The same path and query on the canonical origin: the only place a host
 * redirect is ever allowed to point.
 *
 * The target is the canonical origin with the path and query appended as text.
 * Resolving the path against the origin instead (`new URL(path, origin)`) reads
 * a path that starts `//` as a new authority, which turns the redirect into one
 * to any site the visitor's link names, and throws on some of them.
 */
function onCanonicalOrigin(url: URL): string {
	// The leading slash is what keeps the appended text inside the path, where it
	// can't extend the hostname. URL guarantees it for http(s); this holds even if
	// handed something else.
	const path = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
	return `${SITE_ORIGIN}${path}${url.search}`;
}

/**
 * Where a request for a retired hostname should be sent, or null if the
 * hostname is not one of them.
 */
export function hostRedirectTarget(url: URL): string | null {
	if (!REDIRECT_HOSTNAMES.has(url.hostname)) return null;
	return onCanonicalOrigin(url);
}

/** Fly's health check, the deploy script and the uptime probe all ask for this. */
export const HEALTH_ROUTE = '/api/health';

/** The fuller report the uptime probe reads: disk, roster age, whether writes land. */
export const STATUS_ROUTE = '/api/status';

/**
 * Where a request that arrived on Fly's own hostname should be sent, or null to
 * serve it there.
 *
 * That hostname reaches the app without passing through Cloudflare, so serving
 * the site on it hands out a copy with no edge cache in front and none of
 * Cloudflare's protection. Two things still have to be answered there:
 *
 * - The health check and the status report. They are how the machine is known
 *   to be up and well — by Fly, by the deploy script and by the uptime probe —
 *   and they have to say so about this machine, not about whatever Cloudflare
 *   would answer in its place.
 * - Everything, while `adminDirect` is on. That switch means Cloudflare is
 *   down, which is exactly when the canonical host cannot be reached and this
 *   one is the only way in.
 *
 * This is a courtesy to visitors and crawlers, not a wall. It compares the
 * hostname the request names, and a connection made straight to Fly can name
 * any host it likes; such a request is served like any other, with the Access
 * check and the per-address limit still applying to it.
 */
export function flyRedirectTarget(request: {
	url: URL;
	routeId: string | null;
	adminDirect: boolean;
}): string | null {
	if (request.url.hostname !== FLY_HOSTNAME) return null;
	if (request.adminDirect) return null;
	if (request.routeId === HEALTH_ROUTE || request.routeId === STATUS_ROUTE) return null;
	return onCanonicalOrigin(request.url);
}

/**
 * How many requests one address may make before the rest of the window is
 * answered 429.
 *
 * A visitor costs the origin one request per page: its HTML, or its data when
 * the navigation is client-side. Scripts, styles and fonts are files that
 * adapter-node serves before `handle` is ever called, and headshots come from
 * the leagues. Two requests a second, kept up for a minute, is far beyond
 * anyone reading the site, so the limit is for whatever asks for every page as
 * fast as it can.
 *
 * An address is not a person, though: a school or a mobile carrier puts many
 * people behind one. The headroom is for them, and the edge cache answers most
 * of what a crowd asks for before it gets this far.
 */
export const PAGE_RATE_LIMIT = { limit: 120, windowMs: 60_000 } as const;

/**
 * Routes the limit leaves alone. Matched on the route SvelteKit chose, exactly,
 * so that only the endpoint itself is exempt and not every URL that can be
 * spelled to begin like it.
 */
const UNLIMITED_ROUTES: ReadonlySet<string> = new Set([
	// Monitoring. A probe that is turned away reads as an outage, and Fly stops
	// sending visitors to a machine whose check fails.
	HEALTH_ROUTE,
	STATUS_ROUTE,
	// Reports from the Cloudflare Workers. They all arrive from Cloudflare's
	// addresses, so a count per address would be a count of the whole edge, and
	// they are admitted by a token instead.
	'/api/hit',
	// Has a tighter limit of its own.
	'/api/client-error'
]);

/** What `visitorKey` in client-ip.ts makes of an IPv6 address: its /64. */
const IPV6_BLOCK = /^[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){3}::\/64$/;

/** 127.0.0.0/8, and the block holding ::1 as `visitorKey` writes it. */
const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|0:0:0:0::\/64|::1)$/;

/**
 * The key to count a request against, or null if it is not counted at all.
 *
 * `ip` is what `clientIp` answered. Three kinds of request go uncounted:
 *
 * - The routes above, and /admin, whose login has its own limit and which is
 *   otherwise behind Access and a session. Only the admin route itself: a URL
 *   under /admin that matches no route has either been refused by the Access
 *   check already or is a 404 like any other.
 * - One with no address to count against — `clientIp` could not tell and said
 *   so, or passed on something that is not an address. They would all share a
 *   single key, and the first of them to pass the limit would lock out every
 *   other. Nothing arriving from the internet is in this position: Fly's proxy
 *   stamps an address on every request it forwards.
 * - One from the machine itself. A loopback address is the server run locally
 *   — dev, a production build on a laptop, the e2e suite, which sends hundreds
 *   of requests a minute from 127.0.0.1 — and behind Fly's proxy no visitor
 *   can have one.
 *
 * The last two lean on the address being trustworthy, which it is on Fly and
 * is not anywhere else: off Fly `clientIp` falls back to a header the client
 * writes, and a client that can write its own address was never going to be
 * held by a limit keyed on it.
 */
export function rateLimitKey(request: { routeId: string | null; ip: string }): string | null {
	const { routeId, ip } = request;
	if (routeId !== null && (UNLIMITED_ROUTES.has(routeId) || isAdminPath(routeId))) return null;
	if (isIP(ip) === 0 && !IPV6_BLOCK.test(ip)) return null;
	if (LOOPBACK.test(ip)) return null;
	return ip;
}

/** A wait in milliseconds as a `Retry-After` value: whole seconds, never zero. */
export function retryAfterSeconds(waitMs: number): number {
	return Math.max(1, Math.ceil(waitMs / 1000));
}

/**
 * The home page's route id — the one localized page whose HTML varies per
 * visitor. Every other localized page lives beneath it.
 */
export const HOME_ROUTE = '/[[lang=locale]]';

/** Only pages participate in localization; API routes and the sitemap don't. */
export function isLocalizedRoute(routeId: string | null): boolean {
	return routeId?.startsWith(HOME_ROUTE) ?? false;
}

/**
 * Whether the answer to a request depends on who is asking: a localized page
 * reached without a language prefix, which is either served in English or
 * redirected to French. A prefixed URL has already said which it wants.
 */
export function isLocaleNegotiated(routeId: string | null, lang: string | undefined): boolean {
	return isLocalizedRoute(routeId) && !lang;
}

/**
 * Where a visitor on an unprefixed page should be sent to read it in French, or
 * null to serve the page as asked.
 *
 * The cookie and Accept-Language only decide this one thing. An explicit choice
 * (the cookie the toggle sets) wins over the browser default, so someone who
 * picked English stays put.
 */
export function frenchRedirectTarget(request: {
	routeId: string | null;
	lang: string | undefined;
	cookie: string | null | undefined;
	acceptLanguage: string | null | undefined;
	pathname: string;
	search: string;
}): string | null {
	if (!isLocaleNegotiated(request.routeId, request.lang)) return null;
	if (negotiateLocale(request.cookie, request.acceptLanguage) !== 'fr') return null;
	return `/fr${request.pathname === '/' ? '' : request.pathname}${request.search}`;
}

/**
 * An unprefixed localized URL can answer with either the English page or a
 * redirect to /fr, and which one depends on **both** the Accept-Language header
 * and the locale cookie (see `negotiateLocale`). A shared cache therefore has to
 * key on both, or it will eventually hand a French redirect to someone who
 * explicitly chose English.
 *
 * `Vary: Cookie` is a real cost — every distinct cookie value is its own entry —
 * but it is cheapest for exactly the visitors a traffic spike brings: arriving
 * from a link with no cookies at all, they share one entry.
 */
export const NEGOTIATED_VARY = 'Accept-Language, Cookie';

/**
 * Shared caches may serve a page for five minutes, and one that honours
 * `stale-while-revalidate` may keep serving the stale copy for an hour while it
 * revalidates behind the visitor's back.
 *
 * `max-age=0` deliberately leaves browsers revalidating, so a returning visitor
 * still sees current data; `s-maxage` is the number a CDN actually uses.
 *
 * `stale-while-revalidate` does nothing in the cache that fronts these pages
 * today. The Worker stores them through Cloudflare's Cache API, which ignores
 * the directive (see cloudflare/locale-cache-worker.ts): an entry past its 300
 * seconds is a miss, and the next visitor in each data centre waits on the
 * origin, which may be part-way through an 8s blocking upstream sync. It stays
 * in the header for any standard shared cache that handles a response instead,
 * where it spares that visitor the wait.
 *
 * Rosters refresh on a 12-hour TTL and team lists on 24, so a team page is
 * effectively static between syncs. Re-rendering it per request is waste, and
 * removing that waste is the cheapest protection against a spike there is.
 */
export const PAGE_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

/** For anything that must not be stored: redirects that depend on the visitor, refusals, /admin. */
export const NO_STORE = 'private, no-store';

/**
 * The Cache-Control a response should carry, or null to leave whatever it has.
 *
 * The home page is offered like any other, though its HTML differs by visitor:
 * it renders the grid of the league the URL names or the cookie remembers (see
 * its load function). It says so with Vary: Cookie, which a cache that keys on
 * the whole header would find worthless. The cache this is for does not: the
 * Cloudflare Worker reads the same league out of the request, with the same
 * function, and keeps one copy per league (cloudflare/locale-cache-worker.ts).
 *
 * /admin is behind a session and shows usage data. Never store it anywhere.
 *
 * Anything else — the sitemap, the API routes — sets its own policy or is a
 * POST, so it is left alone rather than given a blanket default.
 *
 * A load can also opt a single response out (`uncacheable`) — a team page with
 * no roster yet, or the home page while a league's teams are missing, so the
 * edge doesn't keep serving the empty state after the sync lands. That has to be a flag rather than "respect whatever cache-control
 * is already there": SvelteKit stamps `private, no-store` on every __data.json
 * response, and overriding it is what lets client-side navigations between
 * pages be cached at all.
 *
 * Only a 200 is offered to shared caches. A 404 for a team that doesn't exist
 * yet, a 500 from a load, or the legacy-URL redirect would otherwise carry the
 * same five-minute invitation as a real page, with nothing but the CDN's own
 * caution keeping an error from outliving its cause.
 */
export function cacheControlFor(response: {
	routeId: string | null;
	pathname: string;
	status: number;
	uncacheable: boolean;
	setsCookie: boolean;
}): string | null {
	if (isAdminRequest(response.routeId, response.pathname) || response.uncacheable) return NO_STORE;
	if (isLocalizedRoute(response.routeId) && !response.setsCookie && response.status === 200) {
		return PAGE_CACHE;
	}
	return null;
}

/**
 * Headers every response carries, whichever branch of `handle` produced it. The
 * CSP is not here: it comes from the csp option of sveltekit() in
 * vite.config.ts, which lets SvelteKit hash its own inline scripts.
 */
export const SECURITY_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
	['X-Content-Type-Options', 'nosniff'],
	['Referrer-Policy', 'strict-origin-when-cross-origin'],
	['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
	// Severs window.opener for cross-origin openers. The only outbound link
	// today (GitHub, in +layout.svelte) already carries rel="noopener", so this
	// is defence in depth for a link added later that forgets to.
	['Cross-Origin-Opener-Policy', 'same-origin'],
	// Fly already forces HTTPS; this tells browsers to stop asking. Ignored
	// over plain http, so it doesn't get in the way of local dev.
	['Strict-Transport-Security', 'max-age=31536000']
];

export function applySecurityHeaders(headers: Headers): void {
	for (const [name, value] of SECURITY_HEADERS) headers.set(name, value);
}

/**
 * Whether an error that reached `handleError` should be recorded and alerted on.
 *
 * Every error comes through there, the routine ones included: crawlers and
 * stale links guessing at team codes (an error(404) from the load, or
 * SvelteKit's own 404), scanners POSTing to pages that have no form actions
 * (405). Alerting on those would bury the errors that matter.
 *
 * What matters is anything nobody raised on purpose, and also a 5xx somebody
 * did: an `error(503)` is the app saying it is broken, just politely.
 */
export function isReportableError(kind: string, status: number): boolean {
	return kind === 'unknown' || status >= 500;
}
