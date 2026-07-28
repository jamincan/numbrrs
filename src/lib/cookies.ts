import type { Locale } from './i18n';
import type { LeagueId } from './leagues';

/**
 * Write a client-side preference cookie: long-lived, Lax, sent to every path,
 * and Secure whenever the page itself came over HTTPS (so plain-http local
 * dev still works).
 *
 * `value` is typed to the two known-safe unions rather than `string` — both
 * are closed sets of short identifiers with no cookie-special characters, and
 * the type is what guarantees that rather than leaving it to callers.
 */
export function rememberCookie(name: string, value: Locale | LeagueId, maxAge: number) {
	const secure = location.protocol === 'https:' ? '; secure' : '';
	document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}
