import type { LeagueId } from '$lib/leagues';

/** A team as reported by a league's API, normalized for the sync layer. */
export interface LeagueTeam {
	code: string; // short code used in URLs, e.g. "TOR"
	name: string; // e.g. "Toronto Sceptres"
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
	| { ok: false; notFound: true }
	| { ok: false; notFound: false; retryAfter: number };

export interface LeagueAdapter {
	id: LeagueId;
	/** The full set of active teams. Throw on failure — the sync layer skips the league. */
	fetchTeams(): Promise<LeagueTeam[]>;
	fetchRoster(team: LeagueTeam): Promise<RosterResult>;
}
