import { redirect } from '@sveltejs/kit';

// Pre-PWHL URLs looked like /game/TOR and were always NHL teams; keep old
// bookmarks working (and keep the /fr prefix if one was there).
export function load({ params }) {
	const prefix = params.lang ? `/${params.lang}` : '';
	redirect(301, `${prefix}/game/nhl/${params.team.toUpperCase()}`);
}
