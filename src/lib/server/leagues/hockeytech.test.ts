import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createHockeyTechAdapter,
	leagueMembers,
	parseRosterEntries,
	pickCurrentSeason,
	rosterSeasons,
	type HockeyTechRosterEntry,
	type HockeyTechSeason,
	type HockeyTechStandingsRow,
	type HockeyTechTeam
} from './hockeytech';

function season(overrides: Partial<HockeyTechSeason>): HockeyTechSeason {
	return {
		season_id: '1',
		season_name: 'Season',
		career: '1',
		playoff: '0',
		start_date: '2025-09-01',
		end_date: '2026-04-30',
		...overrides
	};
}

describe('pickCurrentSeason', () => {
	it('picks the most recent regular season that has started', () => {
		const seasons = [
			season({ season_id: 'old', start_date: '2024-09-20' }),
			season({ season_id: 'current', start_date: '2025-09-18' }),
			season({ season_id: 'future', start_date: '2026-09-17' })
		];
		expect(pickCurrentSeason(seasons, '2026-01-15')?.season_id).toBe('current');
	});

	it('ignores playoff and non-career seasons', () => {
		const seasons = [
			season({ season_id: 'playoffs', playoff: '1', start_date: '2026-05-01' }),
			season({ season_id: 'preseason', career: '0', start_date: '2025-09-01' }),
			season({ season_id: 'regular', start_date: '2025-08-20' })
		];
		expect(pickCurrentSeason(seasons, '2026-06-01')?.season_id).toBe('regular');
	});

	it('keeps last season during the offseason', () => {
		const seasons = [
			season({ season_id: 'last', start_date: '2024-09-20' }),
			season({ season_id: 'next', start_date: '2025-09-18' })
		];
		expect(pickCurrentSeason(seasons, '2025-07-01')?.season_id).toBe('last');
	});

	it('returns undefined when no season has started', () => {
		expect(pickCurrentSeason([season({ start_date: '2099-01-01' })], '2026-01-01')).toBeUndefined();
		expect(pickCurrentSeason([], '2026-01-01')).toBeUndefined();
	});
});

describe('rosterSeasons', () => {
	// The OHL's actual list on the day its 2026-27 season opened, when that
	// season's rosters were still empty.
	const ohl = [
		season({ season_id: '88', start_date: '2026-09-15', end_date: '2027-03-23' }),
		season({ season_id: '87', career: '0', start_date: '2026-08-11', end_date: '2026-09-13' }),
		season({ season_id: '85', playoff: '1', start_date: '2026-03-24', end_date: '2026-06-01' }),
		season({ season_id: '84', career: '0', start_date: '2026-01-10', end_date: '2026-01-10' }),
		season({ season_id: '83', start_date: '2025-09-16', end_date: '2026-03-22' }),
		season({ season_id: '82', career: '0', start_date: '2025-08-13', end_date: '2025-09-14' })
	];

	it('tries the current season, then its preseason, then last season', () => {
		expect(rosterSeasons(ohl, '2026-09-15').map((s) => s.season_id)).toEqual(['88', '87', '83']);
	});

	it('never falls back to a mid-season one-off or a playoff season', () => {
		const ids = rosterSeasons(ohl, '2026-09-15').map((s) => s.season_id);
		expect(ids).not.toContain('84');
		expect(ids).not.toContain('85');
	});

	it('stays on last season through the offseason, ignoring the preseason ahead of it', () => {
		expect(rosterSeasons(ohl, '2026-07-01').map((s) => s.season_id)).toEqual(['83']);
	});

	it('has no fallbacks when there is no earlier regular season', () => {
		expect(
			rosterSeasons([season({ season_id: 'only' })], '2026-01-01').map((s) => s.season_id)
		).toEqual(['only']);
		expect(rosterSeasons([], '2026-01-01')).toEqual([]);
	});
});

function team(id: string, code = `T${id}`): HockeyTechTeam {
	return { id, code, name: `Team ${code}`, city: 'City', nickname: code, team_logo_url: '' };
}

/** A standings row for a team with this many games played and still to play. */
function standing(teamId: string, played: number, remaining: number): HockeyTechStandingsRow {
	return { team_id: teamId, games_played: String(played), games_remaining: String(remaining) };
}

describe('leagueMembers', () => {
	// The OHL on 2026-11-20: twenty teams partway through a 68-game season, and
	// two QMJHL teams on its schedule for two games each. The conference
	// headings in between come through as rows without a team.
	const members = Array.from({ length: 20 }, (_, i) => team(String(i + 1)));
	const gat = team('64', 'GAT');
	const blb = team('75', 'BLB');
	const ohl = [...members, gat, blb];
	const fullSchedule = (played: number) => members.map((t) => standing(t.id, played, 68 - played));

	it('leaves out teams that are only in for a few interleague games', () => {
		const standings = [
			{},
			...members.map((t, i) => standing(t.id, 20 + (i % 5), 48 - (i % 5))),
			{},
			standing(gat.id, 0, 2),
			standing(blb.id, 1, 1)
		];
		expect(leagueMembers(ohl, standings)).toEqual(members);
	});

	it('goes by games scheduled, so it already works before anyone has played', () => {
		const standings = [...fullSchedule(0), standing(gat.id, 0, 2), standing(blb.id, 0, 2)];
		expect(leagueMembers(ohl, standings)).toEqual(members);
	});

	it('keeps every team when the schedule is even', () => {
		// The PWHL's preseason: two games apiece.
		const pwhl = members.slice(0, 12);
		expect(
			leagueMembers(
				pwhl,
				pwhl.map((t) => standing(t.id, 0, 2))
			)
		).toEqual(pwhl);
	});

	it('keeps a team it has no readable count for', () => {
		// Gatineau's count won't parse, and Blainville-Boisbriand has no row.
		const standings = [
			...fullSchedule(30),
			{ team_id: gat.id, games_played: '', games_remaining: '2' }
		];
		expect(leagueMembers(ohl, standings)).toEqual(ohl);
	});

	it('keeps every team when there is nothing to go by', () => {
		expect(leagueMembers(ohl, [])).toEqual(ohl);
		expect(
			leagueMembers(
				ohl,
				ohl.map((t) => standing(t.id, 0, 0))
			)
		).toEqual(ohl);
	});

	it('is not thrown off by one wild count', () => {
		// Measured against the busiest team instead, every real team would look
		// like a visitor next to this one.
		const standings = [...fullSchedule(30), standing(gat.id, 0, 6800), standing(blb.id, 0, 2)];
		expect(leagueMembers(ohl, standings)).toEqual([...members, gat]);
	});
});

describe('createHockeyTechAdapter', () => {
	/**
	 * Stands in for the feed: a three-team league that has one visitor on its
	 * schedule. Returns the query of every request made, in order.
	 */
	type View = (query: URLSearchParams) => Response;

	function serveFeed(overrides: Record<string, View> = {}): URLSearchParams[] {
		const views: Record<string, View> = {
			seasons: () => Response.json({ SiteKit: { Seasons: [season({ season_id: '88' })] } }),
			teamsbyseason: () =>
				Response.json({
					SiteKit: {
						Teamsbyseason: [team('2', 'KGN'), team('5', 'OTT'), team('75', 'BLB'), team('6', 'PBO')]
					}
				}),
			statviewtype: () =>
				Response.json({
					SiteKit: {
						Statviewtype: [
							{ repeatheader: 1, name: 'East Division' },
							standing('2', 23, 45),
							standing('5', 21, 47),
							standing('75', 0, 2),
							standing('6', 23, 45)
						]
					}
				}),
			roster: () => Response.json({ SiteKit: { Roster: [entry({})] } }),
			...overrides
		};
		const requests: URLSearchParams[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const query = new URL(url).searchParams;
				requests.push(query);
				const serve = views[query.get('view') ?? ''];
				if (!serve) throw new Error(`Unexpected view: ${query.get('view')}`);
				return serve(query);
			})
		);
		return requests;
	}

	const adapter = () => createHockeyTechAdapter({ id: 'ohl', clientCode: 'ohl', apiKey: 'key' });

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lists the league's own teams, leaving out the visitor", async () => {
		const requests = serveFeed();
		const log = vi.spyOn(console, 'log').mockImplementation(() => {});

		const teams = await adapter().fetchTeams();

		expect(teams.map((t) => t.code)).toEqual(['KGN', 'OTT', 'PBO']);
		const standings = requests.find((q) => q.get('view') === 'statviewtype');
		expect(standings?.get('type')).toBe('standings');
		expect(standings?.get('season_id')).toBe('88');
		expect(log).toHaveBeenCalledWith('OHL team list leaves out visitors: BLB');
	});

	it('fetches a roster without needing the standings', async () => {
		const requests = serveFeed({ statviewtype: () => new Response('down', { status: 500 }) });
		const ohl = adapter();

		const result = await ohl.fetchRoster({ code: 'OTT', name: "Ottawa 67's", logoUrl: '' });

		expect(result.ok).toBe(true);
		expect(requests.map((q) => q.get('view'))).toEqual(['seasons', 'teamsbyseason', 'roster']);
		expect(requests.at(-1)?.get('team_id')).toBe('5');
		// The team list can't tell members from visitors without them, so it
		// fails rather than guess — leaving the stored list as it was.
		await expect(ohl.fetchTeams()).rejects.toThrow('statviewtype');
	});

	/** Two regular seasons with a preseason between them, as on a season's opening day. */
	const openingDaySeasons = () =>
		Response.json({
			SiteKit: {
				Seasons: [
					season({ season_id: '88', start_date: '2026-09-15', end_date: '2027-03-23' }),
					season({
						season_id: '87',
						career: '0',
						start_date: '2026-08-11',
						end_date: '2026-09-13'
					}),
					season({ season_id: '83', start_date: '2025-09-16', end_date: '2026-03-22' })
				]
			}
		});

	/** Serves a different roster per season, so a test can tell which one was used. */
	function rosterBySeason(rosters: Record<string, HockeyTechRosterEntry[]>): View {
		return (query) =>
			Response.json({ SiteKit: { Roster: rosters[query.get('season_id') ?? ''] ?? [] } });
	}

	it('falls back to an earlier season while the current one lists no players', async () => {
		const requests = serveFeed({
			seasons: openingDaySeasons,
			// The new season opens listing only staff, which parse to nobody.
			roster: rosterBySeason({
				'88': [{ active: '1' }],
				'87': [entry({ player_id: '7' })],
				'83': [entry({ player_id: '3' })]
			})
		});

		const result = await adapter().fetchRoster({ code: 'OTT', name: "Ottawa 67's", logoUrl: '' });

		expect(result.ok && result.players.map((p) => p.id)).toEqual([7]);
		const asked = requests.filter((q) => q.get('view') === 'roster');
		// Stops at the first season with players; last season is never asked for.
		expect(asked.map((q) => q.get('season_id'))).toEqual(['88', '87']);
		expect(asked.every((q) => q.get('team_id') === '5')).toBe(true);
	});

	it('does not look past the current season when it has players', async () => {
		const requests = serveFeed({ seasons: openingDaySeasons });

		const result = await adapter().fetchRoster({ code: 'OTT', name: "Ottawa 67's", logoUrl: '' });

		expect(result.ok && result.players).toHaveLength(1);
		const asked = requests.filter((q) => q.get('view') === 'roster');
		expect(asked.map((q) => q.get('season_id'))).toEqual(['88']);
	});

	it('returns an empty roster, not a failure, when no season has players', async () => {
		serveFeed({ seasons: openingDaySeasons, roster: rosterBySeason({}) });

		const result = await adapter().fetchRoster({ code: 'OTT', name: "Ottawa 67's", logoUrl: '' });

		// The sync layer is what refuses to trust an empty roster.
		expect(result).toEqual({ ok: true, players: [] });
	});

	it('finds roster params under the normalized code, not the feed’s own casing', async () => {
		// The QMJHL feed mixes case ("BaC"); URLs and database ids are uppercase,
		// so that is what the sync layer asks for.
		const requests = serveFeed({
			teamsbyseason: () =>
				Response.json({ SiteKit: { Teamsbyseason: [team('19', 'BaC'), team('5', 'VdO')] } })
		});
		const qmjhl = createHockeyTechAdapter({
			id: 'qmjhl',
			clientCode: 'lhjmq',
			apiKey: 'key',
			teamCode: (t) => t.code.toUpperCase()
		});

		const result = await qmjhl.fetchRoster({ code: 'BAC', name: 'Baie-Comeau', logoUrl: '' });

		expect(result.ok).toBe(true);
		expect(requests.at(-1)?.get('view')).toBe('roster');
		expect(requests.at(-1)?.get('team_id')).toBe('19');
		expect(requests.at(-1)?.get('client_code')).toBe('lhjmq');
	});

	it('reports a team the feed does not list as not-found', async () => {
		serveFeed();
		vi.spyOn(console, 'error').mockImplementation(() => {});

		const result = await adapter().fetchRoster({ code: 'XXX', name: 'Nobody', logoUrl: '' });

		expect(result).toMatchObject({ ok: false, reason: 'not-found' });
	});

	it('tells a changed feed shape from a feed that is down, and says which', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const ott = { code: 'OTT', name: "Ottawa 67's", logoUrl: '' };

		serveFeed({ roster: () => Response.json({ SiteKit: { Roster: { not: 'a list' } } }) });
		const invalid = await adapter().fetchRoster(ott);
		expect(invalid).toMatchObject({ ok: false, reason: 'invalid' });
		expect(!invalid.ok && invalid.detail).toContain('OHL roster schema mismatch');

		serveFeed({ roster: () => new Response('down', { status: 502 }) });
		const transient = await adapter().fetchRoster(ott);
		expect(transient).toMatchObject({ ok: false, reason: 'transient' });
		expect(!transient.ok && transient.detail).toContain('502');

		serveFeed({ teamsbyseason: () => new Response('down', { status: 503 }) });
		const noParams = await adapter().fetchRoster(ott);
		expect(noParams).toMatchObject({ ok: false, reason: 'transient' });
		expect(!noParams.ok && noParams.detail).toContain('503');
	});
});

function entry(overrides: Partial<HockeyTechRosterEntry>): HockeyTechRosterEntry {
	return {
		player_id: '100',
		first_name: 'Jane',
		last_name: 'Doe',
		tp_jersey_number: '17',
		position: 'C',
		player_image: 'https://example.com/jane.jpg',
		active: '1',
		...overrides
	};
}

describe('parseRosterEntries', () => {
	it('parses a well-formed entry', () => {
		expect(parseRosterEntries([entry({})])).toEqual([
			{
				id: 100,
				firstName: 'Jane',
				lastName: 'Doe',
				sweaterNumber: 17,
				positionCode: 'C',
				headshotUrl: 'https://example.com/jane.jpg'
			}
		]);
	});

	it('keeps only active players when the feed marks any', () => {
		const players = parseRosterEntries([
			entry({ player_id: '1', active: '1' }),
			entry({ player_id: '2', active: '0' })
		]);
		expect(players.map((p) => p.id)).toEqual([1]);
	});

	it('keeps everyone when the feed reports nobody active, and says so', () => {
		const onNobodyActive = vi.fn();
		const players = parseRosterEntries(
			[entry({ player_id: '1', active: '0' }), entry({ player_id: '2', active: '0' })],
			onNobodyActive
		);
		expect(players.map((p) => p.id)).toEqual([1, 2]);
		expect(onNobodyActive).toHaveBeenCalledOnce();
	});

	it('skips junk entries without player data', () => {
		const players = parseRosterEntries([
			entry({}),
			{ active: '1' },
			entry({ player_id: 'not-a-number' }),
			entry({ last_name: undefined })
		]);
		expect(players).toHaveLength(1);
	});

	it('stores a missing jersey number as null', () => {
		expect(
			parseRosterEntries([entry({ tp_jersey_number: undefined })])[0]!.sweaterNumber
		).toBeNull();
		expect(parseRosterEntries([entry({ tp_jersey_number: '' })])[0]!.sweaterNumber).toBeNull();
	});

	it('treats a placeholder number outside 0–99 as no number', () => {
		expect(parseRosterEntries([entry({ tp_jersey_number: '999' })])[0]!.sweaterNumber).toBeNull();
		expect(parseRosterEntries([entry({ tp_jersey_number: '0' })])[0]!.sweaterNumber).toBe(0);
		expect(parseRosterEntries([entry({ tp_jersey_number: '99' })])[0]!.sweaterNumber).toBe(99);
	});

	it('normalizes handed positions and passes unknown ones through', () => {
		expect(parseRosterEntries([entry({ position: 'LD' })])[0]!.positionCode).toBe('D');
		expect(parseRosterEntries([entry({ position: 'RW' })])[0]!.positionCode).toBe('R');
		expect(parseRosterEntries([entry({ position: 'HC' })])[0]!.positionCode).toBe('HC');
	});

	it('defaults missing name and image fields', () => {
		const p = parseRosterEntries([entry({ first_name: undefined, player_image: undefined })])[0]!;
		expect(p.firstName).toBe('');
		expect(p.headshotUrl).toBe('');
	});
});
