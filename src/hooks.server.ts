import type { Handle } from '@sveltejs/kit';
import { LOCALE_COOKIE, negotiateLocale } from '$lib/i18n';

/**
 * Resolve the locale before anything renders, so the server emits the right
 * language on the first byte. Reading it from a cookie (rather than
 * localStorage) is what makes that possible — localStorage isn't sent with the
 * request, so the server would have to guess and the page would flash English.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const locale = negotiateLocale(
		event.cookies.get(LOCALE_COOKIE),
		event.request.headers.get('accept-language')
	);

	event.locals.locale = locale;

	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', locale)
	});
};
