import { fetchWithTimeout } from './http';
import type { LeagueAdapter, LeagueTeam, RosterResult } from './types';

const NHL_API_BASE = 'https://api-web.nhle.com/v1';

// Fallback team list, used when the standings endpoint can't be reached or
// comes back empty (it can early in the offseason) so a cold database still
// gets NHL teams. The live list is fetched from the API, which also reports
// each team's French name.
const ACTIVE_TEAMS = [
	'ANA',
	'BOS',
	'BUF',
	'CAR',
	'CBJ',
	'CGY',
	'CHI',
	'COL',
	'DAL',
	'DET',
	'EDM',
	'FLA',
	'LAK',
	'MIN',
	'MTL',
	'NJD',
	'NSH',
	'NYI',
	'NYR',
	'OTT',
	'PHI',
	'PIT',
	'SEA',
	'SJS',
	'STL',
	'TBL',
	'TOR',
	'UTA',
	'VAN',
	'VGK',
	'WPG',
	'WSH'
] as const;

type TEAM_CODE = (typeof ACTIVE_TEAMS)[number];

const TEAM_NAMES: Record<TEAM_CODE, string> = {
	ANA: 'Anaheim Ducks',
	BOS: 'Boston Bruins',
	BUF: 'Buffalo Sabres',
	CAR: 'Carolina Hurricanes',
	CBJ: 'Columbus Blue Jackets',
	CGY: 'Calgary Flames',
	CHI: 'Chicago Blackhawks',
	COL: 'Colorado Avalanche',
	DAL: 'Dallas Stars',
	DET: 'Detroit Red Wings',
	EDM: 'Edmonton Oilers',
	FLA: 'Florida Panthers',
	LAK: 'Los Angeles Kings',
	MIN: 'Minnesota Wild',
	MTL: 'Montréal Canadiens',
	NJD: 'New Jersey Devils',
	NSH: 'Nashville Predators',
	NYI: 'New York Islanders',
	NYR: 'New York Rangers',
	OTT: 'Ottawa Senators',
	PHI: 'Philadelphia Flyers',
	PIT: 'Pittsburgh Penguins',
	SEA: 'Seattle Kraken',
	SJS: 'San Jose Sharks',
	STL: 'St. Louis Blues',
	TBL: 'Tampa Bay Lightning',
	TOR: 'Toronto Maple Leafs',
	UTA: 'Utah Mammoth',
	VAN: 'Vancouver Canucks',
	VGK: 'Vegas Golden Knights',
	WPG: 'Winnipeg Jets',
	WSH: 'Washington Capitals'
};

interface NHLStandingsResponse {
	standings: {
		teamAbbrev: { default: string };
		teamName: { default: string; fr?: string };
		teamLogo: string;
	}[];
}

interface NHLPlayer {
	id: number;
	headshot: string;
	firstName: { default: string };
	lastName: { default: string };
	sweaterNumber?: number;
	positionCode: string;
}

interface NHLRosterResponse {
	forwards: NHLPlayer[];
	defensemen: NHLPlayer[];
	goalies: NHLPlayer[];
}

async function fetchRoster(team: LeagueTeam): Promise<RosterResult> {
	let res: Response;
	let data: NHLRosterResponse;
	try {
		res = await fetchWithTimeout(`${NHL_API_BASE}/roster/${team.code}/current`);
		if (res.status === 429) {
			const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
			console.warn(`429 for ${team.code}, retry after ${retryAfter}s`);
			return { ok: false, reason: 'transient', retryAfter: retryAfter * 1000 };
		}
		if (res.status === 404) {
			console.error(`No NHL roster for ${team.code}`);
			return { ok: false, reason: 'not-found' };
		}
		if (!res.ok) {
			console.error(`Failed to fetch roster for ${team.code}: ${res.status}`);
			return { ok: false, reason: 'transient' };
		}
		data = await res.json();
	} catch (err) {
		console.error(`Failed to fetch roster for ${team.code}:`, err);
		return { ok: false, reason: 'transient' };
	}
	const players = [...data.defensemen, ...data.forwards, ...data.goalies];
	return {
		ok: true,
		players: players.map((p) => ({
			id: p.id,
			firstName: p.firstName.default,
			lastName: p.lastName.default,
			sweaterNumber: p.sweaterNumber ?? null,
			positionCode: p.positionCode,
			headshotUrl: p.headshot
		}))
	};
}

const logoUrl = (code: string) => `https://assets.nhle.com/logos/nhl/svg/${code}_light.svg`;

/**
 * The current teams, from the standings — the NHL has no plain "list of teams"
 * endpoint, but the standings cover exactly the active franchises and carry
 * each team's French name. Sorted by code so the home grid doesn't reshuffle
 * with the day's results.
 */
async function fetchTeams(): Promise<LeagueTeam[]> {
	try {
		const res = await fetchWithTimeout(`${NHL_API_BASE}/standings/now`);
		if (!res.ok) throw new Error(`standings returned ${res.status}`);
		const data: NHLStandingsResponse = await res.json();
		const teams = data.standings.map((t) => ({
			code: t.teamAbbrev.default,
			name: t.teamName.default,
			nameFr: t.teamName.fr,
			logoUrl: t.teamLogo || logoUrl(t.teamAbbrev.default)
		}));
		if (teams.length === 0) throw new Error('standings returned no teams');
		return teams.sort((a, b) => a.code.localeCompare(b.code));
	} catch (err) {
		console.warn('Falling back to the static NHL team list:', err);
		return ACTIVE_TEAMS.map((code) => ({
			code,
			name: TEAM_NAMES[code] || code,
			logoUrl: logoUrl(code)
		}));
	}
}

export const nhlAdapter: LeagueAdapter = {
	id: 'nhl',
	fetchTeams,
	fetchRoster
};
