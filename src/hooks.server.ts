import type { Handle, HandleServerError } from '@sveltejs/kit';
import { LOCALE_COOKIE, isLocale, localeFromPath, negotiateLocale } from '$lib/i18n';
import { recordEvent } from '$lib/server/analytics';
import { reportError } from '$lib/server/alerts';

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
				// Whether this redirect happens depends on the request headers, so
				// caches must not serve one visitor's answer to another.
				headers: { location: target, vary: 'Accept-Language' }
			});
		}
	}

	event.locals.locale = locale;

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', locale)
	});
	if (localized && !lang) {
		response.headers.append('vary', 'Accept-Language');
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
