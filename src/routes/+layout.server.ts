import { DEFAULT_LOCALE, isLocale } from '$lib/i18n';

// The URL owns the locale (see hooks.server.ts); this hands it to the root
// layout so the very first render is already in the right language. It is
// derived from the route param rather than read from locals.locale on purpose:
// accessing `params.lang` is what registers this load's dependency on it, so
// client-side navigations between /... and /fr/... re-run it. locals isn't
// tracked, so the locals version left the layout data — and every message on
// the page — in the old language until a full reload.
export function load({ params }) {
	return { locale: isLocale(params.lang) ? params.lang : DEFAULT_LOCALE };
}
