// Locale primitives, kept free of Svelte imports so `hooks.server.ts` can use
// them. The message catalogues and the reactive store live alongside this in
// `./en`, `./fr` and `./state.svelte.ts`.

export const LOCALES = ['en', 'fr'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Grammatical gender for the nouns French uses to talk about players
 * ("attaquants" vs "attaquantes"). English ignores it entirely, but French has
 * no neutral form, so it's a property of the league — see `LEAGUES`.
 */
export type Gender = 'm' | 'f';

/**
 * The same path in another locale. French URLs carry a /fr prefix; English is
 * the bare path — search engines need distinct URLs per language to index both
 * (and for hreflang to mean anything).
 */
export function localizePath(pathname: string, locale: Locale): string {
	const bare =
		pathname === '/fr' ? '/' : pathname.startsWith('/fr/') ? pathname.slice(3) : pathname;
	if (locale !== 'fr') return bare;
	return bare === '/' ? '/fr' : `/fr${bare}`;
}

export const LOCALE_COOKIE = 'numbrrs_locale';

/** A year. The preference is worth remembering but not worth keeping forever. */
export const LOCALE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string | null | undefined): value is Locale {
	return value != null && (LOCALES as readonly string[]).includes(value);
}

/**
 * Best supported locale from an `Accept-Language` header, or undefined if the
 * browser asked for nothing we speak. Handles quality values ("fr;q=0.9") and
 * matches on the primary subtag, so fr-CA and fr-FR both land on French.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | undefined {
	if (!header) return undefined;

	const ranked = header
		.split(',')
		.map((part) => {
			const [tag, ...params] = part.trim().split(';');
			const quality = params.find((p) => p.trim().startsWith('q='));
			return {
				tag: tag.trim().toLowerCase(),
				q: quality ? Number.parseFloat(quality.split('=')[1]) : 1
			};
		})
		.filter((entry) => entry.tag !== '' && !Number.isNaN(entry.q))
		.sort((a, b) => b.q - a.q);

	for (const { tag } of ranked) {
		const base = tag.split('-')[0];
		if (isLocale(base)) return base;
	}
	return undefined;
}

/**
 * An explicit choice wins; otherwise fall back to what the browser asked for.
 * Resolved on the server from the request, so the first render is already in
 * the right language — no flash of English while the client catches up.
 */
export function negotiateLocale(
	cookie: string | null | undefined,
	acceptLanguage: string | null | undefined
): Locale {
	if (isLocale(cookie)) return cookie;
	return parseAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}
