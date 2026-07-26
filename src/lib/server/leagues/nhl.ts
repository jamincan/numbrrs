import type { LeagueAdapter, LeagueTeam, RosterResult } from './types';

const NHL_API_BASE = 'https://api-web.nhle.com/v1';

export const ACTIVE_TEAMS = [
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

export type TEAM_CODE = (typeof ACTIVE_TEAMS)[number];

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
	const res = await fetch(`${NHL_API_BASE}/roster/${team.code}/current`);
	if (res.status === 429) {
		const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
		console.warn(`429 for ${team.code}, retry after ${retryAfter}s`);
		return { ok: false, notFound: false, retryAfter: retryAfter * 1000 };
	}
	if (!res.ok) {
		console.error(`Failed to fetch roster for ${team.code}: ${res.status}`);
		return { ok: false, notFound: true };
	}
	const data: NHLRosterResponse = await res.json();
	const players = [...data.defensemen, ...data.forwards, ...data.goalies];
	return {
		ok: true,
		players: players.map((p) => ({
			id: p.id,
			firstName: p.firstName.default,
			lastName: p.lastName.default ?? p.lastName,
			sweaterNumber: p.sweaterNumber ?? null,
			positionCode: p.positionCode,
			headshotUrl: p.headshot
		}))
	};
}

export const nhlAdapter: LeagueAdapter = {
	id: 'nhl',
	fetchTeams: async () =>
		ACTIVE_TEAMS.map((code) => ({
			code,
			name: TEAM_NAMES[code] || code,
			logoUrl: `https://assets.nhle.com/logos/nhl/svg/${code}_light.svg`
		})),
	fetchRoster
};
