import type { LeagueId } from '$lib/leagues';
import type { LeagueAdapter, LeaguePlayer, LeagueTeam, RosterResult } from './types';

// HockeyTech/LeagueStat hosts the feeds for several leagues (PWHL, the three
// CHL leagues, AHL, ECHL, USHL...) behind one API shape: every league gets a
// client_code and a key, both published by the leagues' own sites.
const FEED_BASE = 'https://lscluster.hockeytech.com/feed/index.php';

// HockeyTech position strings, normalized to the app's canonical codes. The CHL
// leagues use the handed defence/wing variants; the PWHL only uses the plain
// ones.
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

interface HockeyTechSeason {
	season_id: string;
	season_name: string;
	career: string; // "1" for seasons that count (regular season / playoffs)
	playoff: string; // "1" for playoff "seasons"
	start_date: string; // "YYYY-MM-DD"
	end_date: string;
}

/** A team as the `teamsbyseason` view reports it. */
export interface HockeyTechTeam {
	id: string;
	code: string;
	name: string;
	city: string;
	nickname: string;
	team_logo_url: string;
}

interface HockeyTechRosterEntry {
	player_id?: string;
	first_name?: string;
	last_name?: string;
	tp_jersey_number?: string;
	position?: string;
	player_image?: string;
}

export interface HockeyTechConfig {
	id: LeagueId;
	/** HockeyTech's league slug, which is not always the league's name (the QMJHL is `lhjmq`). */
	clientCode: string;
	apiKey: string;
	/** Display name for a team. Defaults to the feed's own `name`. */
	teamName?: (team: HockeyTechTeam) => string;
	/** Code used in URLs and DB IDs. Defaults to the feed's own `code`. */
	teamCode?: (team: HockeyTechTeam) => string;
}

export function createHockeyTechAdapter(config: HockeyTechConfig): LeagueAdapter {
	const label = config.id.toUpperCase();
	const teamName = config.teamName ?? ((t: HockeyTechTeam) => t.name);
	const teamCode = config.teamCode ?? ((t: HockeyTechTeam) => t.code);

	function feedUrl(params: Record<string, string>): string {
		const search = new URLSearchParams({
			feed: 'modulekit',
			key: config.apiKey,
			fmt: 'json',
			client_code: config.clientCode,
			...params
		});
		return `${FEED_BASE}?${search}`;
	}

	async function fetchFeed<T>(params: Record<string, string>, field: string): Promise<T> {
		const res = await fetch(feedUrl(params));
		if (!res.ok) {
			throw new Error(`${label} feed ${params.view} failed: ${res.status}`);
		}
		const data = await res.json();
		const value = data?.SiteKit?.[field];
		if (value == null) {
			throw new Error(`${label} feed ${params.view} returned no ${field}`);
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
		const seasons = await fetchFeed<HockeyTechSeason[]>({ view: 'seasons' }, 'Seasons');
		const today = new Date().toISOString().slice(0, 10);
		const current = seasons
			.filter((s) => s.career === '1' && s.playoff !== '1' && s.start_date <= today)
			.sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
		if (!current) {
			throw new Error(`${label} feed returned no started regular seasons`);
		}
		return current.season_id;
	}

	// team_id/season_id needed for roster requests, keyed by team code. Rebuilt on
	// every fetchTeams() call, which the sync layer always makes first. Held per
	// adapter, so leagues sharing this factory don't overwrite each other.
	let rosterParams = new Map<string, { seasonId: string; teamId: string }>();

	async function fetchTeams(): Promise<LeagueTeam[]> {
		const seasonId = await currentSeasonId();
		const teams = await fetchFeed<HockeyTechTeam[]>(
			{ view: 'teamsbyseason', season_id: seasonId },
			'Teamsbyseason'
		);
		rosterParams = new Map(teams.map((t) => [teamCode(t), { seasonId, teamId: t.id }]));
		return teams.map((t) => ({
			code: teamCode(t),
			name: teamName(t),
			logoUrl: t.team_logo_url,
			externalId: t.id
		}));
	}

	async function fetchRoster(team: LeagueTeam): Promise<RosterResult> {
		const params = rosterParams.get(team.code);
		if (!params) {
			console.error(`No roster params for ${label} team ${team.code}`);
			return { ok: false, notFound: true };
		}

		let entries: HockeyTechRosterEntry[];
		try {
			entries = await fetchFeed<HockeyTechRosterEntry[]>(
				{ view: 'roster', season_id: params.seasonId, team_id: params.teamId },
				'Roster'
			);
		} catch (err) {
			console.error(`Failed to fetch ${label} roster for ${team.code}:`, err);
			return { ok: false, notFound: true };
		}

		const players: LeaguePlayer[] = [];
		for (const entry of entries) {
			// The feed sometimes appends junk entries with no player data, and the
			// CHL feeds end with a nested array of coaching staff.
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

	return { id: config.id, fetchTeams, fetchRoster };
}
