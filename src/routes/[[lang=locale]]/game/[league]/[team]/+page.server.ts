import { error } from '@sveltejs/kit';
import { isLeagueId } from '$lib/leagues';
import { ensureTeam, hasStoredRoster, loadRoster } from '$lib/server/leagues';

export async function load({ params, locals, depends }) {
	// Lets the page re-run just this load while it waits for a roster to arrive.
	depends('app:roster');

	if (!isLeagueId(params.league)) throw error(404, 'League not found');

	// Team codes are stored uppercase in every league, so /game/nhl/tor should
	// find the same team as /game/nhl/TOR instead of 404ing.
	const code = params.team.toUpperCase();

	const team = await ensureTeam(params.league, code);
	if (!team) throw error(404, 'Team not found');

	// Headers go out before the streamed roster resolves, so whether it will be
	// empty has to be judged from what's stored now. An empty page must not be
	// shared: the edge would keep serving "no roster" for minutes after the sync
	// lands. If the sync below does fill it in, the only cost is this one
	// response going uncached.
	if (!hasStoredRoster(params.league, code)) locals.uncacheable = true;

	// Deliberately not awaited: the page renders as soon as the team is known and
	// SvelteKit streams the roster in when it's ready, refreshing it from the
	// league first if it's stale.
	return { team, roster: loadRoster(params.league, code) };
}
