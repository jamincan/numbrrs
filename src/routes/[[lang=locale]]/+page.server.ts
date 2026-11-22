import { getDb } from '#lib/server/db/index.ts';
import { players, teams } from '#lib/server/db/schema.ts';
import { LEAGUE_COOKIE, LEAGUE_IDS, LEAGUE_PARAM, resolveLeague } from '#lib/leagues.ts';
import { rosterMarks } from '#lib/records.ts';
import { ensureTeams } from '#lib/server/leagues/index.ts';

export async function load({ cookies, url, params, locals, setHeaders }) {
	await ensureTeams();

	const rows = getDb().select().from(teams).all();

	// The wait above is capped and a failing league is skipped, so the list can
	// come back short. A page with a league missing must not be shared: the edge
	// would go on handing out the "still syncing" message for minutes after the
	// sync lands. Every league counts, not just the one on show, because the
	// other tabs are filled from this same response without asking again.
	const listed = new Set(rows.map((team) => team.league));
	if (LEAGUE_IDS.some((id) => !listed.has(id))) locals.uncacheable = true;

	// Which grid this is depends on a cookie, so a cache has to be told. An
	// unprefixed URL is already marked as varying on it by hooks.server.ts, for
	// the language; under /fr nothing else says so.
	if (params.lang) setHeaders({ vary: 'Cookie' });

	// Three characters per player (see `mark` in #lib/records.ts), so that a
	// visitor's own browser can count the players on each roster it has no record
	// of naming, and put that on the team's tile. Sent to everyone, because
	// asking for it only when there is a record to compare would tell the server
	// who has one. Whatever rosters are stored: the home page never waits on a
	// league for them.
	const byTeam: Record<string, { id: number; sweaterNumber: number | null }[]> = {};
	const numbered = getDb()
		.select({ teamId: players.teamId, id: players.id, sweaterNumber: players.sweaterNumber })
		.from(players)
		.all();
	for (const { teamId, ...player } of numbered) (byTeam[teamId] ??= []).push(player);
	const marks: Record<string, string> = {};
	for (const [teamId, roster] of Object.entries(byTeam)) marks[teamId] = rosterMarks(roster);

	return {
		teams: rows,
		marks,
		// The tab to show, resolved server-side so the grid — and its links, which
		// are what crawlers follow — renders on the first byte.
		initialLeague: resolveLeague(url.searchParams.get(LEAGUE_PARAM), cookies.get(LEAGUE_COOKIE))
	};
}
