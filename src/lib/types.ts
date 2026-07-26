/**
 * Row shapes shared with client components. Declared here rather than imported
 * from $lib/server/db so a component importing them can never accidentally
 * pull server-only code (and its native SQLite binding) toward the client
 * bundle. The db module carries compile-time assertions that these stay
 * identical to what the schema actually produces.
 */

export interface Team {
	id: string;
	league: string;
	name: string;
	nameFr: string | null;
	abbreviation: string;
	logoUrl: string;
	rosterSyncedAt: number | null;
}

export interface Player {
	league: string;
	id: number;
	teamId: string;
	firstName: string;
	lastName: string;
	sweaterNumber: number | null;
	positionCode: string;
	headshotUrl: string;
}
