import type { Handle } from '@sveltejs/kit';
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, negotiateLocale } from '$lib/i18n';

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
	const locale = isLocale(lang) ? lang : DEFAULT_LOCALE;

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
	return response;
};
