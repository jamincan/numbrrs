import { z } from 'zod';
import type { LeagueId } from '$lib/leagues';
import { fetchWithTimeout } from './http';
import { FeedSchemaError, parseFeed } from './validate';
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

const seasonSchema = z.object({
	season_id: z.string(),
	season_name: z.string(),
	career: z.string(), // "1" for seasons that count (regular season / playoffs)
	playoff: z.string(), // "1" for playoff "seasons"
	start_date: z.string(), // "YYYY-MM-DD"
	end_date: z.string()
});

const seasonsSchema = z.array(seasonSchema);

/** A team as the `teamsbyseason` view reports it. */
const teamSchema = z.object({
	id: z.string(),
	code: z.string(),
	name: z.string(),
	city: z.string(),
	nickname: z.string(),
	team_logo_url: z.string().catch('')
});

const teamsSchema = z.array(teamSchema);

/**
 * Every field is optional and unknown keys are kept, because `parseRosterEntries`
 * below is what actually decides who counts — and it already copes with the junk
 * this feed appends. An entry that isn't even an object becomes `{}` rather than
 * failing the whole roster, which is the same thing that function does with a
 * row that has no `last_name`.
 */
const rosterEntrySchema = z
	.looseObject({
		player_id: z.string().optional(),
		first_name: z.string().optional(),
		last_name: z.string().optional(),
		tp_jersey_number: z.string().optional(),
		position: z.string().optional(),
		player_image: z.string().optional(),
		active: z.string().optional() // "1" while the player is still on the roster
	})
	.catch({});

/**
 * The envelope is strict — a roster that isn't a list has changed shape and
 * there is nothing to salvage — while the entries inside it are not.
 *
 * Exported for the same reason `parseRosterEntries` is: the leniency is the
 * part worth pinning down, since a schema that is too strict here would empty a
 * team rather than fail loudly.
 */
export const rosterSchema = z.array(rosterEntrySchema);

export type HockeyTechSeason = z.infer<typeof seasonSchema>;
export type HockeyTechTeam = z.infer<typeof teamSchema>;
export type HockeyTechRosterEntry = z.infer<typeof rosterEntrySchema>;

/**
 * The most recent regular season that has started, or undefined if none has.
 * Used because HockeyTech has no "current roster" endpoint — every request is
 * scoped to a season — and during the offseason/preseason users should see
 * last season's rosters (mirroring how the NHL side behaves).
 */
export function pickCurrentSeason(
	seasons: HockeyTechSeason[],
	today: string
): HockeyTechSeason | undefined {
	return seasons
		.filter((s) => s.career === '1' && s.playoff !== '1' && s.start_date <= today)
		.sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
}

/**
 * A season's roster feed lists everyone who appeared for the team, not just the
 * current squad, so a departed player and whoever inherited their sweater both
 * come back — which is why numbers looked duplicated. `active` marks who is
 * still on the roster. If a feed reports nobody active, treat that as a glitch
 * (reported via `onNobodyActive`) and keep the full list rather than empty the
 * team.
 */
export function parseRosterEntries(
	entries: HockeyTechRosterEntry[],
	onNobodyActive?: () => void
): LeaguePlayer[] {
	const active = entries.filter((e) => e?.active === '1');
	if (active.length === 0 && entries.length > 0) {
		onNobodyActive?.();
	}

	const players: LeaguePlayer[] = [];
	for (const entry of active.length > 0 ? active : entries) {
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
	return players;
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

	async function fetchFeed<T>(
		params: Record<string, string>,
		field: string,
		schema: z.ZodType<T>
	): Promise<T> {
		const res = await fetchWithTimeout(feedUrl(params));
		if (!res.ok) {
			throw new Error(`${label} feed ${params.view} failed: ${res.status}`);
		}
		const data = await res.json();
		const value = data?.SiteKit?.[field];
		if (value == null) {
			throw new Error(`${label} feed ${params.view} returned no ${field}`);
		}
		// Throws FeedSchemaError, which callers separate from a network failure:
		// one is worth retrying and the other never is.
		return parseFeed(schema, value, `${label} ${params.view}`);
	}

	async function currentSeasonId(): Promise<string> {
		const seasons = await fetchFeed({ view: 'seasons' }, 'Seasons', seasonsSchema);
		const current = pickCurrentSeason(seasons, new Date().toISOString().slice(0, 10));
		if (!current) {
			throw new Error(`${label} feed returned no started regular seasons`);
		}
		return current.season_id;
	}

	// team_id/season_id needed for roster requests, keyed by team code. Held per
	// adapter, so leagues sharing this factory don't overwrite each other.
	let rosterParams = new Map<string, { seasonId: string; teamId: string }>();

	async function loadTeams(): Promise<LeagueTeam[]> {
		const seasonId = await currentSeasonId();
		const teams = await fetchFeed(
			{ view: 'teamsbyseason', season_id: seasonId },
			'Teamsbyseason',
			teamsSchema
		);
		rosterParams = new Map(teams.map((t) => [teamCode(t), { seasonId, teamId: t.id }]));
		return teams.map((t) => ({
			code: teamCode(t),
			name: teamName(t),
			logoUrl: t.team_logo_url,
			externalId: t.id
		}));
	}

	// Coalesces concurrent callers, so a burst of roster syncs that all need the
	// params doesn't refetch the teams feed once per team.
	let teamsInFlight: Promise<LeagueTeam[]> | null = null;

	function fetchTeams(): Promise<LeagueTeam[]> {
		teamsInFlight ??= loadTeams().finally(() => {
			teamsInFlight = null;
		});
		return teamsInFlight;
	}

	async function fetchRoster(team: LeagueTeam): Promise<RosterResult> {
		let params = rosterParams.get(team.code);
		if (!params) {
			// A roster request needs the season and team IDs from the teams feed.
			// Rosters are synced one team at a time on demand, so after a restart
			// this map is empty even though the team is known from the database.
			try {
				await fetchTeams();
			} catch (err) {
				if (err instanceof FeedSchemaError) {
					console.error(err.message);
					return { ok: false, reason: 'invalid' };
				}
				console.error(`Failed to load ${label} roster params:`, err);
				return { ok: false, reason: 'transient' };
			}
			params = rosterParams.get(team.code);
		}
		if (!params) {
			// The feed answered but doesn't list this team — it really is gone.
			console.error(`No roster params for ${label} team ${team.code}`);
			return { ok: false, reason: 'not-found' };
		}

		let entries: HockeyTechRosterEntry[];
		try {
			entries = await fetchFeed(
				{ view: 'roster', season_id: params.seasonId, team_id: params.teamId },
				'Roster',
				rosterSchema
			);
		} catch (err) {
			if (err instanceof FeedSchemaError) {
				console.error(err.message);
				return { ok: false, reason: 'invalid' };
			}
			console.error(`Failed to fetch ${label} roster for ${team.code}:`, err);
			return { ok: false, reason: 'transient' };
		}

		const players = parseRosterEntries(entries, () =>
			console.warn(`${label} roster for ${team.code} reports nobody active; keeping all entries`)
		);
		return { ok: true, players };
	}

	return { id: config.id, fetchTeams, fetchRoster };
}
