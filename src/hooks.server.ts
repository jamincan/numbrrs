import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/env';
import { ADMIN_DIRECT, ADMIN_TOKEN } from '$app/env/private';
import { LOCALE_COOKIE, isLocale, localeFromPath } from '#lib/i18n/index.ts';
import { weakTokenWarning } from '#lib/server/admin.ts';
import { recordEvent } from '#lib/server/analytics.ts';
import { reportError } from '#lib/server/alerts.ts';
import { clientIp } from '#lib/server/client-ip.ts';
import { ACCESS_COOKIE, ACCESS_HEADER, verifyAccessToken } from '#lib/server/cloudflare-access.ts';
import { bootstrap, closeDb } from '#lib/server/db/index.ts';
import { startSweeps } from '#lib/server/leagues/index.ts';
import { installProcessGuards } from '#lib/server/process-guards.ts';
import {
	NEGOTIATED_VARY,
	NO_STORE,
	applySecurityHeaders,
	cacheControlFor,
	frenchRedirectTarget,
	hostRedirectTarget,
	isLocaleNegotiated,
	isLocalizedRoute,
	isReportableError,
	requiresAccess
} from '#lib/server/request-policy.ts';

// Boot. Runs once, when the server module graph loads. Guarded by `building` so
// it doesn't fire during `vite build`, which imports this module to prerender
// pages. Order matters: the database first, since everything after it may
// write to it.
if (!building) {
	bootstrap();

	// adapter-node emits this once it has stopped taking requests and the ones in
	// flight have finished, so nothing is left to query the database.
	process.on('sveltekit:shutdown', closeDb);

	// Not in dev: Vite reloads this module on every edit, and a handler that ends
	// the process has no business sitting under a dev server.
	if (!dev) installProcessGuards();

	// Production only: a dev server left open would otherwise walk five leagues'
	// APIs every hour for a local database nobody is looking at. The on-demand
	// path still refreshes whatever a dev actually opens.
	if (!dev) startSweeps();

	if (!dev) {
		// The admin page shows a banner as well; this puts it in the logs too.
		if (ADMIN_DIRECT) {
			console.warn('[admin] ADMIN_DIRECT is set: /admin is skipping the Cloudflare Access check');
		}
		const weakToken = weakTokenWarning(ADMIN_TOKEN);
		if (weakToken) console.warn(weakToken);
	}
}

/**
 * A response `handle` writes itself instead of getting from `resolve`. These
 * leave early, so they would otherwise miss the headers stamped on the way out.
 */
function respond(status: number, headers: Record<string, string>, body?: string): Response {
	const response = new Response(body, { status, headers });
	applySecurityHeaders(response.headers);
	return response;
}

/**
 * The URL owns the locale: /fr/... renders French, everything else English.
 * Giving each language its own URL is what lets search engines index both and
 * lets hreflang tie them together — a cookie-only locale is invisible to a
 * crawler.
 *
 * Every decision here is made by a function in request-policy.ts, where the
 * reasoning lives and where it is tested; this only gathers what those
 * functions need from the request and acts on what they answer.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { url, request } = event;
	const routeId = event.route.id;

	// Permanent, unconditional, and ahead of everything else: every path and
	// query string carries straight over, and nothing downstream (locale,
	// caching) needs to know this host was ever in play.
	const canonical = hostRedirectTarget(url);
	if (canonical) {
		return respond(301, { location: canonical, 'cache-control': 'public, max-age=86400' });
	}

	// /admin answers only requests that came through Cloudflare Access (see
	// cloudflare-access.ts), and its own token login still applies on top. The
	// cookie stands in for the header in case Access is ever set to cover /admin
	// itself but not the data requests under it.
	if (requiresAccess({ routeId, pathname: url.pathname, dev, adminDirect: ADMIN_DIRECT })) {
		const token = request.headers.get(ACCESS_HEADER) ?? event.cookies.get(ACCESS_COOKIE);
		const access = await verifyAccessToken(token);
		if (!access.ok) {
			console.warn(
				`[admin] refused ${request.method} ${url.pathname.slice(0, 200)} from ${clientIp(event)}: ${access.reason}`
			);
			return respond(403, { 'cache-control': NO_STORE }, 'Forbidden');
		}
	}

	const lang = event.params.lang;
	// Falls back to the path, not to English: a URL matching no route has no
	// params, and /fr/nonexistent should still stamp <html lang="fr"> and be
	// counted as a French visit.
	const locale = isLocale(lang) ? lang : localeFromPath(url.pathname);

	const french = frenchRedirectTarget({
		routeId,
		lang,
		cookie: event.cookies.get(LOCALE_COOKIE),
		acceptLanguage: request.headers.get('accept-language'),
		pathname: url.pathname,
		search: url.search
	});
	if (french) {
		return respond(302, {
			location: french,
			// Whether this redirect happens depends on the request headers, so
			// caches must not serve one visitor's answer to another.
			vary: NEGOTIATED_VARY,
			// A bare 302 is already uncacheable by default, but saying so beats
			// relying on every cache in the path agreeing about the default.
			'cache-control': NO_STORE
		});
	}

	event.locals.locale = locale;

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', locale)
	});
	if (isLocaleNegotiated(routeId, lang)) {
		response.headers.append('vary', NEGOTIATED_VARY);
	}

	const cacheControl = cacheControlFor({
		routeId,
		pathname: url.pathname,
		status: response.status,
		uncacheable: event.locals.uncacheable ?? false,
		setsCookie: response.headers.has('set-cookie')
	});
	if (cacheControl) response.headers.set('cache-control', cacheControl);

	applySecurityHeaders(response.headers);

	// Count the visit once the response is known to be a real page. Client-side
	// navigations still land here — SvelteKit fetches the next page's data
	// through the same hook — so moving from the grid into a game is counted
	// without any browser-side script.
	if (isLocalizedRoute(routeId) && response.status < 400) {
		recordEvent(event, { name: 'pageview' });
	}

	return response;
};

/**
 * Every server error passes through here. SvelteKit already logs to
 * stdout, but Fly doesn't keep what is written there, so by the time anyone
 * looks the evidence is gone — hence writing it down.
 *
 * The return value is what the error page renders, so it stays generic: the
 * detail goes to the database and to Discord, not to the visitor.
 */
export const handleError: HandleServerError = (caught) => {
	const { event } = caught;
	// Anything thrown by accident is a 500 by the time the visitor sees it;
	// everything else arrives carrying the status it was raised with.
	const status = caught.kind === 'unknown' ? 500 : caught.error.status;

	// Every error comes through here, the routine ones included, and alerting on
	// those would bury the ones that matter. See `isReportableError`.
	if (!isReportableError(caught.kind, status)) return;

	const thrown = caught.kind === 'unknown' ? caught.error : null;
	const message =
		caught.kind === 'unknown'
			? thrown instanceof Error
				? thrown.message
				: String(thrown)
			: // A deliberate error(503, …) has no stack; the status is what says
				// where to start looking.
				`${status} ${caught.error.message}`;

	// The returned id is the error's fingerprint, so a visitor quoting it off the
	// error page points at exactly one row in the dashboard rather than at a log
	// line that Fly has since thrown away.
	const id = reportError({
		source: 'server',
		message,
		stack: thrown instanceof Error ? thrown.stack : null,
		route: event.route.id ?? event.url.pathname,
		error: thrown
	});

	return { id };
};
