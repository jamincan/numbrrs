import { negotiateLocale } from '#lib/i18n/index.ts';
import { REDIRECT_HOSTNAMES, SITE_ORIGIN } from '#lib/site.ts';

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
 * Where a request for a retired hostname should be sent, or null if the
 * hostname is one the app serves.
 *
 * The target is the canonical origin with the path and query appended as text.
 * Resolving the path against the origin instead (`new URL(path, origin)`) reads
 * a path that starts `//` as a new authority, which turns the redirect into one
 * to any site the visitor's link names, and throws on some of them.
 */
export function hostRedirectTarget(url: URL): string | null {
	if (!REDIRECT_HOSTNAMES.has(url.hostname)) return null;
	// The leading slash is what keeps the appended text inside the path, where it
	// can't extend the hostname. URL guarantees it for http(s); this holds even if
	// handed something else.
	const path = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
	return `${SITE_ORIGIN}${path}${url.search}`;
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
 * The home page resolves the remembered league tab server-side so the grid and
 * its links are in the first byte for crawlers (see its load function). That is
 * good for SEO and it means the HTML differs per visitor, so it must not be
 * shared — Vary: Cookie would be correct and would also make the entry
 * worthless. Team pages are the long tail worth caching and have no such
 * dependency.
 *
 * /admin is behind a session and shows usage data. Never store it anywhere.
 *
 * Anything else — the sitemap, the API routes — sets its own policy or is a
 * POST, so it is left alone rather than given a blanket default.
 *
 * A load can also opt a single response out (`uncacheable`) — a team page with
 * no roster yet, so the edge doesn't keep serving the empty state after the
 * sync lands. That has to be a flag rather than "respect whatever cache-control
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
	if (response.routeId === HOME_ROUTE) return 'private, no-cache';
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
