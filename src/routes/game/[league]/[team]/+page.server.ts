import { error } from '@sveltejs/kit';
import { isLeagueId } from '$lib/leagues';
import { ensureTeam, loadRoster } from '$lib/server/leagues';

export async function load({ params }) {
	if (!isLeagueId(params.league)) throw error(404, 'League not found');

	const team = await ensureTeam(params.league, params.team);
	if (!team) throw error(404, 'Team not found');

	// Deliberately not awaited: the page renders as soon as the team is known and
	// SvelteKit streams the roster in when it's ready, refreshing it from the
	// league first if it's stale.
	return { team, roster: loadRoster(params.league, params.team) };
}
