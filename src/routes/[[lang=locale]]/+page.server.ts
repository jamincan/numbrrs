import { getDb } from '#lib/server/db/index.ts';
import { teams } from '#lib/server/db/schema.ts';
import { LEAGUE_COOKIE, LEAGUE_IDS, LEAGUE_PARAM, resolveLeague } from '#lib/leagues.ts';
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

	return {
		teams: rows,
		// The tab to show, resolved server-side so the grid — and its links, which
		// are what crawlers follow — renders on the first byte.
		initialLeague: resolveLeague(url.searchParams.get(LEAGUE_PARAM), cookies.get(LEAGUE_COOKIE))
	};
}
