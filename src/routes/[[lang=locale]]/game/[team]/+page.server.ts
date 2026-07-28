import { redirect } from '@sveltejs/kit';

// Pre-PWHL URLs looked like /game/TOR and were always NHL teams; keep old
// bookmarks working (and keep the /fr prefix if one was there).
export function load({ params }) {
	const prefix = params.lang ? `/${params.lang}` : '';
	// encodeURIComponent: params.team is attacker-controlled and lands in a
	// Location header. Not a live vulnerability today — a route segment can't
	// contain '/', and Node rejects CR/LF in header values, so the worst case
	// is a 500 rather than header injection — but the pattern doesn't belong
	// in the codebase regardless of whether this instance is exploitable.
	redirect(301, `${prefix}/game/nhl/${encodeURIComponent(params.team.toUpperCase())}`);
}
