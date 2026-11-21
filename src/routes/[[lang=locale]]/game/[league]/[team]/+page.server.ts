import { error, redirect } from '@sveltejs/kit';
import { isLeagueId } from '#lib/leagues.ts';
import {
	ensureTeam,
	hasStoredRoster,
	isRosterStale,
	loadRoster
} from '#lib/server/leagues/index.ts';

export async function load({ params, url, locals, depends }) {
	// Lets the page re-run just this load while it waits for a roster to arrive.
	depends('app:roster');

	if (!isLeagueId(params.league)) throw error(404, 'League not found');

	// Team codes are stored uppercase in every league, so /game/nhl/tor should
	// find the same team as /game/nhl/TOR instead of 404ing.
	const code = params.team.toUpperCase();

	const team = await ensureTeam(params.league, code);
	if (!team) throw error(404, 'Team not found');

	// Only the stored casing is the team's address, though. Left to answer in
	// place, every other casing is a second copy of the page that names itself
	// as canonical. Checked after the lookup so a code that doesn't exist is
	// still a plain 404 rather than a redirect to one. Only the last segment
	// changes, so a /fr prefix and any query string carry over.
	if (params.team !== code) {
		const base = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1);
		throw redirect(308, base + encodeURIComponent(code) + url.search);
	}

	// Headers go out before a streamed roster resolves, so whether it will be
	// empty has to be judged from what's stored now. An empty page must not be
	// shared: the edge would keep serving "no roster" for minutes after the sync
	// lands. If the sync below does fill it in, the only cost is this one
	// response going uncached.
	if (!hasStoredRoster(params.league, code)) locals.uncacheable = true;

	// A roster that is stored and current is only a database read away, so it is
	// waited for: the page is then rendered with the players' names in it rather
	// than a spinner, which is all a crawler — or a first paint — would otherwise
	// get.
	//
	// One that needs the league first (never fetched, or gone stale) is
	// deliberately not awaited: the page renders as soon as the team is known and
	// SvelteKit streams the roster in when the refresh has finished. Serving the
	// stored copy of a stale roster straight away instead would start the game on
	// players the refresh is about to swap out.
	//
	// Judged before loadRoster runs its own check. If the roster goes stale in
	// between, the await is simply a wait for the refresh.
	const fresh = !isRosterStale(team);
	const roster = loadRoster(params.league, code);
	return { team, roster: fresh ? await roster : roster };
}
