import { getDb } from '$lib/server/db';
import { teams } from '$lib/server/db/schema';
import { DEFAULT_LEAGUE, LEAGUE_COOKIE, isLeagueId } from '$lib/leagues';
import { ensureTeams } from '$lib/server/leagues';

export async function load({ cookies }) {
	await ensureTeams();

	const saved = cookies.get(LEAGUE_COOKIE) ?? '';
	return {
		teams: getDb().select().from(teams).all(),
		// The remembered tab, resolved server-side so the grid — and its links,
		// which are what crawlers follow — renders on the first byte.
		initialLeague: isLeagueId(saved) ? saved : DEFAULT_LEAGUE
	};
}
