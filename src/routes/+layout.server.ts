import { isLocale, localeFromPath } from '$lib/i18n';

// The URL owns the locale (see hooks.server.ts); this hands it to the root
// layout so the very first render is already in the right language. It is
// derived from the route param rather than read from locals.locale on purpose:
// accessing `params.lang` is what registers this load's dependency on it, so
// client-side navigations between /... and /fr/... re-run it. locals is not a
// tracked dependency, so reading the locale from there would not re-run this
// load on client-side navigation — the layout data, and every message on the
// page, would stay in the old language until a full reload.
//
// The path fallback is for URLs that match no route: this load still runs, but
// there are no params, so `params.lang` is undefined even on /fr/... Defaulting
// to English there would hand a French visitor an English 404. Reading `url`
// only in that branch keeps it out of the dependency set on every other page.
export function load({ params, url }) {
	return { locale: isLocale(params.lang) ? params.lang : localeFromPath(url.pathname) };
}
