import type { Gender, Locale } from '$lib/i18n';

// League identifiers shared between server and client code. Server-only
// adapter code lives in $lib/server/leagues.
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

export function isLeagueId(value: string): value is LeagueId {
	return (LEAGUE_IDS as string[]).includes(value);
}

/** Database team ID, namespaced by league so codes like "TOR" don't collide. */
export function teamDbId(league: LeagueId, code: string): string {
	return `${league}:${code}`;
}
