import type { Handle, HandleServerError } from '@sveltejs/kit';
import { LOCALE_COOKIE, isLocale, localeFromPath, negotiateLocale } from '$lib/i18n';
import { recordEvent } from '$lib/server/analytics';
import { reportError } from '$lib/server/alerts';

/** The home page's route id — the one localized page whose HTML varies per visitor. */
const HOME_ROUTE = '/[[lang=locale]]';

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
const NEGOTIATED_VARY = 'Accept-Language, Cookie';

/**
 * Shared caches may serve a page for five minutes, and may keep serving a stale
 * one for an hour while they revalidate behind the visitor's back.
 *
 * `max-age=0` deliberately leaves browsers revalidating, so a returning visitor
 * still sees current data; `s-maxage` is the number a CDN actually uses.
 * `stale-while-revalidate` matters most here: it means a cache miss never waits
 * on an origin that might be part-way through an 8s blocking upstream sync.
 *
 * Rosters refresh on a 12-hour TTL and team lists on 24, so a team page is
 * effectively static between syncs. Re-rendering it per request is waste, and
 * removing that waste is the cheapest protection against a spike there is.
 */
const PAGE_CACHE = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

/**
 * The URL owns the locale: /fr/... renders French, everything else English.
 * Giving each language its own URL is what lets search engines index both and
 * lets hreflang tie them together — a cookie-only locale is invisible to a
 * crawler.
 *
 * The cookie and Accept-Language only decide one thing: whether a visitor
 * landing on an unprefixed page should be redirected to the French URLs. An
 * explicit choice (the cookie the toggle sets) wins over the browser default,
 * so someone who picked English stays put.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const lang = event.params.lang;
	// Falls back to the path, not to English: a URL matching no route has no
	// params, and /fr/nonexistent should still stamp <html lang="fr"> and be
	// counted as a French visit.
	const locale = isLocale(lang) ? lang : localeFromPath(event.url.pathname);

	// Only pages participate in localization; API routes and the sitemap don't.
	const localized = event.route.id?.startsWith('/[[lang=locale]]') ?? false;

	if (localized && !lang) {
		const preferred = negotiateLocale(
			event.cookies.get(LOCALE_COOKIE),
			event.request.headers.get('accept-language')
		);
		if (preferred === 'fr') {
			const target = `/fr${event.url.pathname === '/' ? '' : event.url.pathname}${event.url.search}`;
			return new Response(null, {
				status: 302,
				headers: {
					location: target,
					// Whether this redirect happens depends on the request headers, so
					// caches must not serve one visitor's answer to another.
					vary: NEGOTIATED_VARY,
					// A bare 302 is already uncacheable by default, but saying so beats
					// relying on every cache in the path agreeing about the default.
					'cache-control': 'private, no-store'
				}
			});
		}
	}

	event.locals.locale = locale;

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', locale)
	});
	if (localized && !lang) {
		response.headers.append('vary', NEGOTIATED_VARY);
	}

	// Caching, in three cases.
	//
	// The home page resolves the remembered league tab server-side so the grid
	// and its links are in the first byte for crawlers (see its load function).
	// That is good for SEO and it means the HTML differs per visitor, so it must
	// not be shared — Vary: Cookie would be correct and would also make the entry
	// worthless. Team pages are the long tail worth caching and have no such
	// dependency.
	//
	// /admin is behind a session and shows usage data. Never store it anywhere.
	//
	// Anything else — the sitemap, the API routes — sets its own policy or is a
	// POST, so it is left alone rather than given a blanket default.
	if (event.route.id === '/admin') {
		response.headers.set('cache-control', 'private, no-store');
	} else if (event.route.id === HOME_ROUTE) {
		response.headers.set('cache-control', 'private, no-cache');
	} else if (localized && !response.headers.has('set-cookie')) {
		response.headers.set('cache-control', PAGE_CACHE);
	}

	// The CSP itself comes from kit.csp in svelte.config.js, which lets
	// SvelteKit hash its own inline scripts.
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	// Fly already forces HTTPS; this tells browsers to stop asking. Ignored
	// over plain http, so it doesn't get in the way of local dev.
	response.headers.set('Strict-Transport-Security', 'max-age=31536000');

	// Count the visit once the response is known to be a real page. Client-side
	// navigations still land here — SvelteKit fetches the next page's data
	// through the same hook — so moving from the grid into a game is counted
	// without any browser-side script.
	if (localized && response.status < 400) {
		recordEvent(event, { name: 'pageview' });
	}

	return response;
};

/**
 * Every unhandled server error passes through here. SvelteKit already logs to
 * stdout, but Fly keeps no history and stops the machine when it's idle, so by
 * the time anyone looks the evidence is gone — hence writing it down.
 *
 * The return value is what the error page renders, so it stays generic: the
 * detail goes to the database and to Discord, not to the visitor.
 */
export const handleError: HandleServerError = ({ error, event, status, message }) => {
	// 404s are routine here — crawlers and stale links guessing at team codes —
	// and alerting on them would bury the errors that matter.
	if (status === 404) return { message };

	// The returned id is the error's fingerprint, so a visitor quoting it off the
	// error page points at exactly one row in the dashboard rather than at a log
	// line that Fly has since thrown away.
	const id = reportError({
		source: 'server',
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : null,
		route: event.route.id ?? event.url.pathname
	});

	return { message, id };
};
