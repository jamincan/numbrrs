import { z } from 'zod';
import { reportError } from '../alerts';
import { fetchWithTimeout } from './http';
import { parseFeed } from './validate';
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

// The NHL wraps display strings in a per-language object rather than returning
// a bare string, which is the shape most likely to change under us.
const standingsSchema = z.object({
	standings: z.array(
		z.object({
			teamAbbrev: z.object({ default: z.string() }),
			teamName: z.object({ default: z.string(), fr: z.string().optional() }),
			// A constructed URL covers a missing logo, so it isn't worth failing over.
			teamLogo: z.string().catch('')
		})
	)
});

const playerSchema = z.object({
	id: z.number(),
	headshot: z.string().catch(''),
	firstName: z.object({ default: z.string() }),
	lastName: z.object({ default: z.string() }),
	sweaterNumber: z.number().optional(),
	positionCode: z.string()
});

type NHLPlayer = z.infer<typeof playerSchema>;

/**
 * The position groups have to be arrays — if they aren't, the feed has changed
 * shape and there is nothing to salvage. Individual players are allowed to fail
 * and drop out: one malformed row shouldn't cost a visitor the other
 * twenty-two. Dropped rows are counted and logged, so quiet shrinkage still
 * leaves a trace.
 */
const rosterSchema = z.object({
	forwards: z.array(playerSchema.nullable().catch(null)),
	defensemen: z.array(playerSchema.nullable().catch(null)),
	goalies: z.array(playerSchema.nullable().catch(null))
});

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** What a 429 with no usable Retry-After is taken to mean. */
const DEFAULT_RETRY_AFTER_MS = 60_000;

/** e.g. `Sat, 21 Nov 2026 12:00:30 GMT` */
const HTTP_DATE = /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/**
 * A Retry-After header as a delay in milliseconds. The header is either a
 * number of seconds or an HTTP date, and reading a date as a number gives NaN —
 * which a timer treats as zero, turning "wait" into "retry immediately".
 */
export function retryAfterMs(header: string | null, now = Date.now()): number {
	const value = header?.trim() ?? '';
	if (/^\d+$/.test(value)) return Number(value) * 1000;

	// Only the one date format HTTP still sends. Date.parse on its own is far
	// too generous: it reads "-5" as a day in May 2001.
	if (!HTTP_DATE.test(value)) return DEFAULT_RETRY_AFTER_MS;
	const until = Date.parse(value);
	return Number.isFinite(until) ? Math.max(0, until - now) : DEFAULT_RETRY_AFTER_MS;
}

async function fetchRoster(team: LeagueTeam): Promise<RosterResult> {
	let payload: unknown;
	try {
		const res = await fetchWithTimeout(`${NHL_API_BASE}/roster/${team.code}/current`);
		if (res.status === 429) {
			const retryAfter = retryAfterMs(res.headers.get('retry-after'));
			console.warn(`429 for ${team.code}, retry after ${Math.round(retryAfter / 1000)}s`);
			return {
				ok: false,
				reason: 'transient',
				retryAfter,
				detail: `roster/${team.code} returned 429 (retry after ${Math.round(retryAfter / 1000)}s)`
			};
		}
		if (res.status === 404) {
			console.error(`No NHL roster for ${team.code}`);
			return { ok: false, reason: 'not-found', detail: `roster/${team.code} returned 404` };
		}
		if (!res.ok) {
			console.error(`Failed to fetch roster for ${team.code}: ${res.status}`);
			return {
				ok: false,
				reason: 'transient',
				detail: `roster/${team.code} returned ${res.status}`
			};
		}
		payload = await res.json();
	} catch (err) {
		console.error(`Failed to fetch roster for ${team.code}:`, err);
		return { ok: false, reason: 'transient', detail: errorMessage(err) };
	}

	// Parsing sits outside the fetch's try on purpose: a shape mismatch is not a
	// transient failure and must not be retried into the same answer twice.
	let data: z.infer<typeof rosterSchema>;
	try {
		data = parseFeed(rosterSchema, payload, `NHL roster ${team.code}`);
	} catch (err) {
		// parseFeed is the only thing that throws here, and only for a mismatch.
		// This function's contract is that it never throws.
		console.error(errorMessage(err));
		return { ok: false, reason: 'invalid', detail: errorMessage(err) };
	}

	const rows = [...data.defensemen, ...data.forwards, ...data.goalies];
	const players = rows.filter((p): p is NHLPlayer => p !== null);
	if (players.length < rows.length) {
		console.warn(
			`NHL roster ${team.code}: skipped ${rows.length - players.length} unreadable entries`
		);
	}

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
		// Parsed inside the try, so a schema change lands on the static-list
		// fallback below like any other failure — but with a log line naming the
		// field that moved rather than a TypeError from three lines further on.
		const data = parseFeed(standingsSchema, await res.json(), 'NHL standings');
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
		// The fallback returns a full list, so the sync layer records a success and
		// nothing else would ever say the live list is unavailable — while French
		// names go missing and a relocated team keeps its old tile. One report per
		// fetch, with a fixed message so every cause folds into the same alert; the
		// cause itself travels in the stack.
		reportError({
			source: 'sync',
			message: 'NHL standings unavailable; using the static team list',
			stack: err instanceof Error ? (err.stack ?? err.message) : String(err),
			route: 'sync:teams:nhl'
		});
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
