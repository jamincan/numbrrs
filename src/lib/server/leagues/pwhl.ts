import type { LeagueAdapter, LeaguePlayer, LeagueTeam, RosterResult } from './types';

// The PWHL publishes data through HockeyTech/LeagueStat. The key is the
// publicly documented one used by the league's own site; see
// https://github.com/IsabelleLefebvre97/PWHL-Data-Reference
const PWHL_FEED_BASE = 'https://lscluster.hockeytech.com/feed/index.php';
const PWHL_API_KEY = '446521baf8c38984';
const PWHL_CLIENT_CODE = 'pwhl';

// HockeyTech position strings, normalized to the app's canonical codes.
const POSITION_MAP: Record<string, string> = {
	G: 'G',
	D: 'D',
	LD: 'D',
	RD: 'D',
	F: 'F',
	C: 'C',
	LW: 'L',
	RW: 'R'
};

interface PWHLSeason {
	season_id: string;
	season_name: string;
	career: string; // "1" for seasons that count (regular season / playoffs)
	playoff: string; // "1" for playoff "seasons"
	start_date: string; // "YYYY-MM-DD"
	end_date: string;
}

interface PWHLTeam {
	id: string;
	code: string;
	name: string;
	team_logo_url: string;
}

interface PWHLRosterEntry {
	player_id?: string;
	first_name?: string;
	last_name?: string;
	tp_jersey_number?: string;
	position?: string;
	player_image?: string;
}

function feedUrl(params: Record<string, string>): string {
	const search = new URLSearchParams({
		feed: 'modulekit',
		key: PWHL_API_KEY,
		fmt: 'json',
		client_code: PWHL_CLIENT_CODE,
		...params
	});
	return `${PWHL_FEED_BASE}?${search}`;
}

async function fetchFeed<T>(params: Record<string, string>, field: string): Promise<T> {
	const res = await fetch(feedUrl(params));
	if (!res.ok) {
		throw new Error(`PWHL feed ${params.view} failed: ${res.status}`);
	}
	const data = await res.json();
	const value = data?.SiteKit?.[field];
	if (value == null) {
		throw new Error(`PWHL feed ${params.view} returned no ${field}`);
	}
	return value as T;
}

/**
 * Unlike the NHL API, HockeyTech has no "current roster" endpoint — every
 * request is scoped to a season. Use the most recent regular season that has
 * started, so during the offseason/preseason users see last season's rosters
 * (mirroring how the NHL side behaves).
 */
async function currentSeasonId(): Promise<string> {
	const seasons = await fetchFeed<PWHLSeason[]>({ view: 'seasons' }, 'Seasons');
	const today = new Date().toISOString().slice(0, 10);
	const current = seasons
		.filter((s) => s.career === '1' && s.playoff !== '1' && s.start_date <= today)
		.sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
	if (!current) {
		throw new Error('PWHL feed returned no started regular seasons');
	}
	return current.season_id;
}

// team_id/season_id needed for roster requests, keyed by team code. Rebuilt on
// every fetchTeams() call, which the sync layer always makes first.
let rosterParams = new Map<string, { seasonId: string; teamId: string }>();

async function fetchTeams(): Promise<LeagueTeam[]> {
	const seasonId = await currentSeasonId();
	const teams = await fetchFeed<PWHLTeam[]>(
		{ view: 'teamsbyseason', season_id: seasonId },
		'Teamsbyseason'
	);
	rosterParams = new Map(teams.map((t) => [t.code, { seasonId, teamId: t.id }]));
	return teams.map((t) => ({
		code: t.code,
		name: t.name,
		logoUrl: t.team_logo_url,
		externalId: t.id
	}));
}

async function fetchRoster(team: LeagueTeam): Promise<RosterResult> {
	const params = rosterParams.get(team.code);
	if (!params) {
		console.error(`No roster params for PWHL team ${team.code}`);
		return { ok: false, notFound: true };
	}

	let entries: PWHLRosterEntry[];
	try {
		entries = await fetchFeed<PWHLRosterEntry[]>(
			{ view: 'roster', season_id: params.seasonId, team_id: params.teamId },
			'Roster'
		);
	} catch (err) {
		console.error(`Failed to fetch PWHL roster for ${team.code}:`, err);
		return { ok: false, notFound: true };
	}

	const players: LeaguePlayer[] = [];
	for (const entry of entries) {
		// The feed sometimes appends junk entries with no player data.
		const id = parseInt(entry.player_id ?? '', 10);
		if (isNaN(id) || !entry.last_name) continue;

		const sweaterNumber = parseInt(entry.tp_jersey_number ?? '', 10);
		const position = entry.position ?? '';
		players.push({
			id,
			firstName: entry.first_name ?? '',
			lastName: entry.last_name,
			sweaterNumber: isNaN(sweaterNumber) ? null : sweaterNumber,
			positionCode: POSITION_MAP[position] ?? position,
			headshotUrl: entry.player_image ?? ''
		});
	}
	return { ok: true, players };
}

export const pwhlAdapter: LeagueAdapter = {
	id: 'pwhl',
	fetchTeams,
	fetchRoster
};
