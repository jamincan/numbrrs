import type { LeagueId } from '$lib/leagues';

/** A team as reported by a league's API, normalized for the sync layer. */
export interface LeagueTeam {
	code: string; // short code used in URLs, e.g. "TOR"
	name: string; // e.g. "Toronto Sceptres"
	/** French name, when the league's feed publishes one (the NHL does). */
	nameFr?: string;
	logoUrl: string;
	/** Opaque league-specific identifier needed to fetch this team's roster. */
	externalId?: string;
}

/**
 * A player normalized to the app's canonical model. positionCode uses the
 * canonical set: L, C, R, F (generic forward), D, G. Anything else is shown
 * under "Other".
 */
export interface LeaguePlayer {
	id: number; // league-specific player ID (unique within the league)
	firstName: string;
	lastName: string;
	sweaterNumber: number | null;
	positionCode: string;
	headshotUrl: string; // empty string when the league has no headshot
}

export type RosterResult =
	| { ok: true; players: LeaguePlayer[] }
	// The league says the team has no roster — retrying won't change that.
	| { ok: false; reason: 'not-found' }
	// Network error, timeout, 5xx, rate limit... worth one retry. When the
	// league said how long to back off (a 429's Retry-After), it's passed on.
	| { ok: false; reason: 'transient'; retryAfter?: number };

export interface LeagueAdapter {
	id: LeagueId;
	/** The full set of active teams. Throw on failure — the sync layer skips the league. */
	fetchTeams(): Promise<LeagueTeam[]>;
	/** Never throws: failures are reported through the result. */
	fetchRoster(team: LeagueTeam): Promise<RosterResult>;
}
