import { z } from 'zod';
import type { LeagueId } from '#lib/leagues.ts';
import { fetchWithTimeout } from './http';
import {
	FeedSchemaError,
	imageUrlSchema,
	parseFeed,
	playerNameSchema,
	positionSchema,
	sweaterNumber,
	TEAM_CODE,
	teamNameSchema
} from './validate';
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

/**
 * A team as the `teamsbyseason` view reports it. Only the shape is checked
 * here, because this list also carries visiting teams and is what roster
 * requests get their ids from: one odd row must not stop every roster in the
 * league refreshing. What a team may contain is checked on the way into the
 * team list instead (see `storedTeamsSchema`). `id` and the season fields are
 * only ever sent back to the feed as query parameters.
 */
const teamSchema = z.object({
	id: z.string(),
	code: z.string(),
	name: z.string(),
	city: z.string(),
	nickname: z.string(),
	team_logo_url: imageUrlSchema
});

const teamsSchema = z.array(teamSchema);

/**
 * The teams about to be stored, checked as the app will use them: the code
 * after any normalizing (the QMJHL's mixed-case "BaC" is fine once uppercased)
 * and the name as it will be displayed. One unusable team fails the whole list
 * rather than dropping out of it, since a team left out of the list is a team
 * deleted.
 */
const storedTeamsSchema = z.array(
	z.object({
		code: z.string().regex(TEAM_CODE),
		name: teamNameSchema,
		logoUrl: z.string()
	})
);

/**
 * A row of the standings (`statviewtype`) view. Only the scheduled-games counts
 * are read, to tell a league's own teams from visitors (see `leagueMembers`).
 * The conference headings between the rows have no `team_id`, and a row that
 * won't parse just leaves its team unaccounted for, which keeps it.
 */
const standingsRowSchema = z
	.object({
		team_id: z.string().optional(),
		games_played: z.string().optional(),
		games_remaining: z.string().optional()
	})
	.catch({});

const standingsSchema = z.array(standingsRowSchema);

/** A player id: digits only, within `PLAYER_ID_MAX`. The largest real one is 30,456. */
const PLAYER_ID = /^[1-9]\d{0,8}$/;

/**
 * Whether a rejected roster entry was a player's row rather than the junk the
 * feed appends, which has no id or no name. Only a player's row is worth a line
 * in the log.
 */
function looksLikePlayer(value: unknown): boolean {
	if (typeof value !== 'object' || value === null) return false;
	const { player_id, last_name } = value as Record<string, unknown>;
	return Boolean(player_id) && Boolean(last_name);
}

/**
 * Every field is optional and unknown keys are kept, because `parseRosterEntries`
 * below is what actually decides who counts — and it already copes with the junk
 * this feed appends. An entry that isn't even an object becomes `{}` rather than
 * failing the whole roster, which is the same thing that function does with a
 * row that has no `last_name`.
 *
 * A player's row with a field past its limit is dropped the same way, and the
 * rest of the team kept. It is marked `unreadable` on the way out so the
 * adapter can say how many went: a roster that quietly loses players should
 * leave a trace.
 */
const rosterEntrySchema = z
	.looseObject({
		player_id: z.string().regex(PLAYER_ID).optional(),
		first_name: playerNameSchema.optional(),
		last_name: playerNameSchema.optional(),
		tp_jersey_number: z.string().optional(),
		position: positionSchema.optional(),
		player_image: imageUrlSchema.optional(),
		active: z.string().optional() // "1" while the player is still on the roster
	})
	.catch((ctx) => (looksLikePlayer(ctx.value) ? { unreadable: true } : {}));

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
export type HockeyTechStandingsRow = z.infer<typeof standingsRowSchema>;
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
 * The seasons to try for a roster, best first: the current regular season,
 * then any preseason that ran between it and the previous regular season,
 * then that previous season.
 *
 * The fallbacks exist for the first days of a new season. HockeyTech opens the
 * season on its start date but teams fill in its rosters later, so for a while
 * the current season lists only coaching staff. The preseason roster is this
 * year's team and the best stand-in; last season's is the one after that.
 * Only non-career seasons that start after the previous season ended count as
 * preseason, so a mid-season one-off like a prospects game can never supply a
 * team's roster.
 */
export function rosterSeasons(seasons: HockeyTechSeason[], today: string): HockeyTechSeason[] {
	const current = pickCurrentSeason(seasons, today);
	if (!current) return [];
	const previous = pickCurrentSeason(
		seasons.filter((s) => s.start_date < current.start_date),
		today
	);
	if (!previous) return [current];

	const preseasons = seasons
		.filter(
			(s) =>
				s.career !== '1' &&
				s.playoff !== '1' &&
				s.start_date > previous.end_date &&
				s.start_date < current.start_date
		)
		.sort((a, b) => b.start_date.localeCompare(a.start_date));
	return [current, ...preseasons, previous];
}

/**
 * The teams that belong to the league, leaving out visitors from other leagues.
 *
 * A season's team list is every team with a game on its schedule, so
 * interleague play brings in the other league's teams: in 2026-27 the OHL's
 * list includes Blainville-Boisbriand and Gatineau, and the QMJHL's includes
 * four OHL teams. Nothing in the team list marks them, since each sits in one
 * of the host league's divisions. The standings do give each team's scheduled
 * games (played plus remaining), and there a visitor has a couple where a
 * member has a full season. So a team scheduled for fewer than half the games
 * of the league's median team is a visitor.
 *
 * The median rather than the busiest team, so one bad row can't make the whole
 * league look like visitors; it also caps what can be left out at half the
 * teams. A team the standings don't account for is kept: leaving out a real
 * team deletes it and its roster, while keeping a visitor costs one wrong tile.
 */
export function leagueMembers(
	teams: HockeyTechTeam[],
	standings: HockeyTechStandingsRow[]
): HockeyTechTeam[] {
	const scheduled = new Map<string, number>();
	for (const row of standings) {
		// parseInt rather than Number so an empty count is unknown, not zero.
		const games = parseInt(row.games_played ?? '', 10) + parseInt(row.games_remaining ?? '', 10);
		if (row.team_id && !isNaN(games)) scheduled.set(row.team_id, games);
	}

	const counts = [...scheduled.values()].sort((a, b) => a - b);
	const median = counts[Math.floor(counts.length / 2)];
	// No standings, or no games scheduled yet: nothing to tell teams apart by.
	if (!median) return teams;

	return teams.filter((t) => {
		const games = scheduled.get(t.id);
		return games === undefined || games * 2 >= median;
	});
}

/**
 * A season's roster feed lists everyone who appeared for the team, not just the
 * current squad, so a departed player and whoever inherited their sweater both
 * come back. `active` marks who is still on the roster. If a feed reports
 * nobody active, treat that as a glitch (reported via `onNobodyActive`) and
 * keep the full list rather than empty the team.
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

		const position = entry.position ?? '';
		players.push({
			id,
			firstName: entry.first_name ?? '',
			lastName: entry.last_name,
			sweaterNumber: sweaterNumber(parseInt(entry.tp_jersey_number ?? '', 10)),
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
	/**
	 * Code used in URLs and DB IDs. Defaults to the feed's own `code`. Whatever
	 * this returns has to match `TEAM_CODE`, capitals included, or the league's
	 * team list is refused.
	 */
	teamCode?: (team: HockeyTechTeam) => string;
}

/** A season's team list as the feed reports it, visitors included. */
interface SeasonTeams {
	seasonId: string;
	teams: HockeyTechTeam[];
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

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

	/** Season IDs to try for rosters, best first (see `rosterSeasons`). */
	async function candidateSeasonIds(): Promise<string[]> {
		const seasons = await fetchFeed({ view: 'seasons' }, 'Seasons', seasonsSchema);
		const candidates = rosterSeasons(seasons, new Date().toISOString().slice(0, 10));
		if (candidates.length === 0) {
			throw new Error(`${label} feed returned no started regular seasons`);
		}
		return candidates.map((s) => s.season_id);
	}

	// team_id and the season_ids to try, needed for roster requests, keyed by
	// team code. Held per adapter, so leagues sharing this factory don't
	// overwrite each other.
	let rosterParams = new Map<string, { seasonIds: string[]; teamId: string }>();

	/**
	 * The current season's team list, refreshing `rosterParams` on the way.
	 * That's all a roster request needs, so rosters don't depend on the
	 * standings that `fetchTeams` uses to leave out visitors.
	 */
	async function loadSeasonTeams(): Promise<SeasonTeams> {
		const seasonIds = await candidateSeasonIds();
		// The team list always comes from the current season. HockeyTech keeps a
		// team's ID across seasons, so the same ID works for the fallbacks.
		const seasonId = seasonIds[0] ?? '';
		const teams = await fetchFeed(
			{ view: 'teamsbyseason', season_id: seasonId },
			'Teamsbyseason',
			teamsSchema
		);
		rosterParams = new Map(teams.map((t) => [teamCode(t), { seasonIds, teamId: t.id }]));
		return { seasonId, teams };
	}

	// Coalesces concurrent callers, so a burst of roster syncs that all need the
	// params doesn't refetch the teams feed once per team.
	let seasonTeamsInFlight: Promise<SeasonTeams> | null = null;

	function fetchSeasonTeams(): Promise<SeasonTeams> {
		seasonTeamsInFlight ??= loadSeasonTeams().finally(() => {
			seasonTeamsInFlight = null;
		});
		return seasonTeamsInFlight;
	}

	async function fetchTeams(): Promise<LeagueTeam[]> {
		const { seasonId, teams } = await fetchSeasonTeams();
		// The view needs a grouping, and by conference lists each team once.
		const standings = await fetchFeed(
			{ view: 'statviewtype', type: 'standings', stat: 'conference', season_id: seasonId },
			'Statviewtype',
			standingsSchema
		);
		const members = leagueMembers(teams, standings);
		const visitors = teams.filter((t) => !members.includes(t));
		if (visitors.length > 0) {
			console.log(`${label} team list leaves out visitors: ${visitors.map(teamCode).join(', ')}`);
		}
		return parseFeed(
			storedTeamsSchema,
			members.map((t) => ({
				code: teamCode(t),
				name: teamName(t),
				logoUrl: t.team_logo_url
			})),
			`${label} team list`
		);
	}

	async function fetchRoster(team: LeagueTeam): Promise<RosterResult> {
		let params = rosterParams.get(team.code);
		if (!params) {
			// A roster request needs the season and team IDs from the teams feed.
			// Rosters are synced one team at a time on demand, so after a restart
			// this map is empty even though the team is known from the database.
			try {
				await fetchSeasonTeams();
			} catch (err) {
				if (err instanceof FeedSchemaError) {
					console.error(err.message);
					return { ok: false, reason: 'invalid', detail: err.message };
				}
				console.error(`Failed to load ${label} roster params:`, err);
				return { ok: false, reason: 'transient', detail: errorMessage(err) };
			}
			params = rosterParams.get(team.code);
		}
		if (!params) {
			// The feed answered but doesn't list this team — it really is gone.
			console.error(`No roster params for ${label} team ${team.code}`);
			return {
				ok: false,
				reason: 'not-found',
				detail: `${label} teamsbyseason does not list ${team.code}`
			};
		}

		// Later seasons are only asked for when an earlier one has no players, which
		// in practice means the first days of a new season.
		let players: LeaguePlayer[] = [];
		for (const seasonId of params.seasonIds) {
			let entries: HockeyTechRosterEntry[];
			try {
				entries = await fetchFeed(
					{ view: 'roster', season_id: seasonId, team_id: params.teamId },
					'Roster',
					rosterSchema
				);
			} catch (err) {
				if (err instanceof FeedSchemaError) {
					console.error(err.message);
					return { ok: false, reason: 'invalid', detail: err.message };
				}
				console.error(`Failed to fetch ${label} roster for ${team.code}:`, err);
				return { ok: false, reason: 'transient', detail: errorMessage(err) };
			}

			const unreadable = entries.filter((e) => e.unreadable === true).length;
			if (unreadable > 0) {
				console.warn(`${label} roster for ${team.code}: skipped ${unreadable} unreadable entries`);
			}

			players = parseRosterEntries(entries, () =>
				console.warn(`${label} roster for ${team.code} reports nobody active; keeping all entries`)
			);
			if (players.length > 0) break;
		}
		return { ok: true, players };
	}

	return { id: config.id, fetchTeams, fetchRoster };
}
