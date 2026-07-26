import { redirect } from "@sveltejs/kit";

// Pre-PWHL URLs looked like /game/TOR and were always NHL teams; keep old
// bookmarks working.
export function load({ params }) {
    redirect(301, `/game/nhl/${params.team}`);
}
