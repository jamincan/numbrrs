// League identifiers shared between server and client code. Server-only
// adapter code lives in $lib/server/leagues.
export const LEAGUES = [
	{ id: 'nhl', label: 'NHL' },
	{ id: 'pwhl', label: 'PWHL' },
	{ id: 'whl', label: 'WHL' },
	{ id: 'ohl', label: 'OHL' },
	{ id: 'qmjhl', label: 'QMJHL' }
] as const;

export type LeagueId = (typeof LEAGUES)[number]['id'];

export const LEAGUE_IDS = LEAGUES.map((l) => l.id);

export function isLeagueId(value: string): value is LeagueId {
	return (LEAGUE_IDS as string[]).includes(value);
}

/** Database team ID, namespaced by league so codes like "TOR" don't collide. */
export function teamDbId(league: LeagueId, code: string): string {
	return `${league}:${code}`;
}
