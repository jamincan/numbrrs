import type { Gender, Locale } from '#lib/i18n/index.ts';

// League identifiers shared between server and client code. Server-only
// adapter code lives in #lib/server/leagues.
//
// `gender` is the grammatical gender French needs for the nouns used to talk
// about a league's players; it has no effect in English. The WHL and OHL keep
// their English acronyms because the leagues themselves don't use a French one.
export const LEAGUES = [
	{ id: 'nhl', label: { en: 'NHL', fr: 'LNH' }, gender: 'm' },
	{ id: 'pwhl', label: { en: 'PWHL', fr: 'LPHF' }, gender: 'f' },
	{ id: 'whl', label: { en: 'WHL', fr: 'WHL' }, gender: 'm' },
	{ id: 'ohl', label: { en: 'OHL', fr: 'OHL' }, gender: 'm' },
	{ id: 'qmjhl', label: { en: 'QMJHL', fr: 'LHJMQ' }, gender: 'm' }
] as const satisfies readonly {
	id: string;
	label: Record<Locale, string>;
	gender: Gender;
}[];

export type LeagueId = (typeof LEAGUES)[number]['id'];

/**
 * Which set of French player nouns a league takes. Defaults to masculine for
 * anything unrecognized, which is also French's default for a mixed group.
 */
export function leagueGender(league: string): Gender {
	return LEAGUES.find((l) => l.id === league)?.gender ?? 'm';
}

export const LEAGUE_IDS = LEAGUES.map((l) => l.id);

/**
 * Remembered league tab for the home page. A cookie rather than localStorage
 * so the server can render the right grid on the first byte — localStorage is
 * unavailable server-side, so the grid could only render after hydration and
 * crawlers would see a loading message instead of links to team pages.
 */
export const LEAGUE_COOKIE = 'numbrrs_league';

/** A year: worth remembering, not worth keeping forever. */
export const LEAGUE_MAX_AGE = 60 * 60 * 24 * 365;

export const DEFAULT_LEAGUE: LeagueId = 'nhl';

export function isLeagueId(value: string): value is LeagueId {
	return (LEAGUE_IDS as string[]).includes(value);
}

/** The query parameter a league tab's link carries: `/?league=pwhl`. */
export const LEAGUE_PARAM = 'league';

/**
 * Which league's grid the home page shows: the one the URL names, else the one
 * the cookie remembers, else the default. The URL wins because it is what a
 * visitor without JavaScript clicked, and what a shared link asked for.
 *
 * Anything that is not a known league id is ignored rather than refused, so
 * each source falls through to the next. The Cloudflare Worker calls this too,
 * to file a home page under the league the origin will render for the same
 * request (see cloudflare/locale-cache-worker.ts) — the two have to agree, and
 * sharing the function is what makes them.
 */
export function resolveLeague(
	param: string | null | undefined,
	cookie: string | null | undefined
): LeagueId {
	if (param != null && isLeagueId(param)) return param;
	if (cookie != null && isLeagueId(cookie)) return cookie;
	return DEFAULT_LEAGUE;
}

/** Database team ID, namespaced by league so codes like "TOR" don't collide. */
export function teamDbId(league: LeagueId, code: string): string {
	return `${league}:${code}`;
}
