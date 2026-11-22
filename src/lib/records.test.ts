import { describe, expect, it } from 'vitest';
import {
	betterMedal,
	emptyRecords,
	goldCount,
	hasRecords,
	mark,
	MARK_LENGTH,
	newCount,
	newPlayers,
	rosterMarks,
	parseRecords,
	recordKnown,
	recordRun,
	seasonOf,
	teamBest,
	teamMedal,
	type Records
} from './records';

const TEAM = 'nhl:TOR';
const SEASON = 2026;

describe('seasonOf', () => {
	it('turns over on September 1, by the local calendar', () => {
		expect(seasonOf(new Date(2026, 7, 31, 23, 59))).toBe(2025);
		expect(seasonOf(new Date(2026, 8, 1, 0, 0))).toBe(2026);
		expect(seasonOf(new Date(2026, 11, 31))).toBe(2026);
		expect(seasonOf(new Date(2027, 0, 1))).toBe(2026);
		expect(seasonOf(new Date(2027, 5, 15))).toBe(2026);
	});
});

describe('betterMedal', () => {
	it('keeps the more valuable of the two', () => {
		expect(betterMedal('bronze', 'gold')).toBe('gold');
		expect(betterMedal('gold', 'silver')).toBe('gold');
		expect(betterMedal(undefined, 'bronze')).toBe('bronze');
		expect(betterMedal('silver', undefined)).toBe('silver');
		expect(betterMedal(undefined, undefined)).toBeUndefined();
	});
});

describe('recordRun', () => {
	it('earns the level’s medal for a run with no misses', () => {
		const records = recordRun(emptyRecords(), TEAM, SEASON, {
			level: 'easy',
			found: 25,
			total: 25
		});

		expect(teamMedal(records, TEAM, SEASON)).toBe('bronze');
		expect(teamBest(records, TEAM, SEASON, 'easy')).toEqual([25, 25]);
		expect(records.teams[TEAM]?.completed).toBe(true);
	});

	it('earns nothing for a run with a miss, but keeps the score', () => {
		const records = recordRun(emptyRecords(), TEAM, SEASON, {
			level: 'hard',
			found: 24,
			total: 25
		});

		expect(teamMedal(records, TEAM, SEASON)).toBeNull();
		expect(teamBest(records, TEAM, SEASON, 'hard')).toEqual([24, 25]);
		expect(records.teams[TEAM]?.completed).toBe(true);
	});

	it('earns no medal at Learn, however the run went', () => {
		const records = recordRun(emptyRecords(), TEAM, SEASON, {
			level: 'learn',
			found: 25,
			total: 25
		});

		expect(teamMedal(records, TEAM, SEASON)).toBeNull();
		expect(teamBest(records, TEAM, SEASON, 'learn')).toEqual([25, 25]);
	});

	it('never takes a medal away: a lesser run after a better one changes nothing', () => {
		let records = recordRun(emptyRecords(), TEAM, SEASON, { level: 'hard', found: 25, total: 25 });
		records = recordRun(records, TEAM, SEASON, { level: 'easy', found: 25, total: 25 });
		records = recordRun(records, TEAM, SEASON, { level: 'hard', found: 3, total: 25 });

		expect(teamMedal(records, TEAM, SEASON)).toBe('gold');
		expect(teamBest(records, TEAM, SEASON, 'hard')).toEqual([25, 25]);
	});

	it('replaces a medal with a better one', () => {
		let records = recordRun(emptyRecords(), TEAM, SEASON, { level: 'easy', found: 25, total: 25 });
		records = recordRun(records, TEAM, SEASON, { level: 'medium', found: 25, total: 25 });

		expect(teamMedal(records, TEAM, SEASON)).toBe('silver');
	});

	it('keeps the best score per level, comparing by share of the roster', () => {
		let records = recordRun(emptyRecords(), TEAM, SEASON, { level: 'easy', found: 20, total: 25 });
		records = recordRun(records, TEAM, SEASON, { level: 'easy', found: 18, total: 25 });
		expect(teamBest(records, TEAM, SEASON, 'easy')).toEqual([20, 25]);

		// The roster has grown: 22 of 27 is a larger share than 20 of 25.
		records = recordRun(records, TEAM, SEASON, { level: 'easy', found: 22, total: 27 });
		expect(teamBest(records, TEAM, SEASON, 'easy')).toEqual([22, 27]);

		// Another level's score is its own.
		expect(teamBest(records, TEAM, SEASON, 'medium')).toBeNull();
	});

	it('keeps each season apart, so a new one starts with nothing', () => {
		const records = recordRun(emptyRecords(), TEAM, SEASON, {
			level: 'hard',
			found: 25,
			total: 25
		});

		expect(teamMedal(records, TEAM, SEASON + 1)).toBeNull();
		expect(teamBest(records, TEAM, SEASON + 1, 'hard')).toBeNull();
		// The earlier season is still on record.
		const next = recordRun(records, TEAM, SEASON + 1, { level: 'easy', found: 25, total: 25 });
		expect(teamMedal(next, TEAM, SEASON)).toBe('gold');
		expect(teamMedal(next, TEAM, SEASON + 1)).toBe('bronze');
	});

	it('ignores a run with nobody to find, and does not mutate its input', () => {
		const start = emptyRecords();
		expect(recordRun(start, TEAM, SEASON, { level: 'easy', found: 0, total: 0 })).toBe(start);

		recordRun(start, TEAM, SEASON, { level: 'easy', found: 5, total: 5 });
		expect(start).toEqual(emptyRecords());
	});
});

describe('recordKnown', () => {
	it('adds a player and number once', () => {
		let records = recordKnown(emptyRecords(), TEAM, 8478483, 34);
		const again = recordKnown(records, TEAM, 8478483, 34);

		// The same object back: nothing changed, so there is nothing to save.
		expect(again).toBe(records);
		expect(records.teams[TEAM]?.known).toEqual(['8478483:34']);
		expect(records.teams[TEAM]?.completed).toBe(false);

		// A new number for the same player is something new to have learned.
		records = recordKnown(records, TEAM, 8478483, 43);
		expect(records.teams[TEAM]?.known).toEqual(['8478483:34', '8478483:43']);
	});

	it('leaves the team’s medals alone', () => {
		let records = recordRun(emptyRecords(), TEAM, SEASON, { level: 'hard', found: 5, total: 5 });
		records = recordKnown(records, TEAM, 1, 9);

		expect(teamMedal(records, TEAM, SEASON)).toBe('gold');
	});
});

describe('goldCount', () => {
	it('counts only gold, only for the teams asked about, only this season', () => {
		let records = recordRun(emptyRecords(), 'nhl:TOR', SEASON, {
			level: 'hard',
			found: 5,
			total: 5
		});
		records = recordRun(records, 'nhl:MTL', SEASON, { level: 'medium', found: 5, total: 5 });
		records = recordRun(records, 'nhl:OTT', SEASON - 1, { level: 'hard', found: 5, total: 5 });
		records = recordRun(records, 'pwhl:TOR', SEASON, { level: 'hard', found: 5, total: 5 });

		expect(goldCount(records, ['nhl:TOR', 'nhl:MTL', 'nhl:OTT', 'nhl:BOS'], SEASON)).toBe(1);
		expect(goldCount(records, ['pwhl:TOR'], SEASON)).toBe(1);
		expect(goldCount(records, [], SEASON)).toBe(0);
	});
});

describe('parseRecords', () => {
	it('starts empty when nothing is stored', () => {
		expect(parseRecords(null)).toEqual(emptyRecords());
		expect(hasRecords(emptyRecords())).toBe(false);
	});

	it('reads back what was written', () => {
		let records = recordRun(emptyRecords(), TEAM, SEASON, { level: 'hard', found: 24, total: 25 });
		records = recordRun(records, TEAM, SEASON, { level: 'easy', found: 25, total: 25 });
		records = recordKnown(records, TEAM, 7, 91);

		expect(parseRecords(JSON.stringify(records))).toEqual(records);
		expect(hasRecords(records)).toBe(true);
	});

	it.each([
		['text that is not JSON', '{"v":1,"teams":'],
		['JSON that is not an object', '"numbrrs"'],
		['a list', '[]'],
		['null', 'null']
	])('starts empty when storage holds %s', (_name, raw) => {
		expect(parseRecords(raw)).toEqual(emptyRecords());
	});

	it('keeps what is a record and leaves out what is not', () => {
		const stored = {
			v: 1,
			teams: {
				'nhl:TOR': {
					completed: 'yes',
					known: ['1:34', '1:34', 'x:1', 12, '2:'],
					seasons: {
						'2026': { medal: 'platinum', best: { easy: [5, 5], expert: [5, 5], hard: [6, 5] } },
						'26': { medal: 'gold', best: {} },
						'2025': { medal: 'gold' },
						'2024': 'a good year'
					}
				},
				'nhl:MTL': 'champions'
			}
		};

		const records = parseRecords(JSON.stringify(stored)) as Records;

		expect(Object.keys(records.teams)).toEqual(['nhl:TOR']);
		const team = records.teams['nhl:TOR']!;
		expect(team.completed).toBe(false);
		expect(team.known).toEqual(['1:34']);
		expect(Object.keys(team.seasons).sort()).toEqual(['2025', '2026']);
		// No such medal, no such level, and nobody finds more players than there are.
		expect(team.seasons['2026']).toEqual({ best: { easy: [5, 5] } });
		expect(team.seasons['2025']).toEqual({ medal: 'gold', best: {} });
	});

	it('will not read, or stand in for, records from a newer build', () => {
		expect(parseRecords(JSON.stringify({ v: 2, teams: {} }))).toBeNull();
	});
});

describe('mark', () => {
	it('is three characters, the same every time, and safe to run together', () => {
		const one = mark(8478483, 34);

		expect(one).toHaveLength(MARK_LENGTH);
		expect(one).toMatch(/^[A-Za-z0-9_-]{3}$/);
		expect(mark(8478483, 34)).toBe(one);
	});

	it('changes with the player and with the number', () => {
		expect(mark(8478483, 43)).not.toBe(mark(8478483, 34));
		expect(mark(8478484, 34)).not.toBe(mark(8478483, 34));
	});

	it('rarely gives two players on a team the same one', () => {
		// A whole league's worth of rosters, with ids and numbers like real ones.
		let clashes = 0;
		for (let team = 0; team < 32; team++) {
			const seen = new Set<string>();
			for (let i = 0; i < 28; i++) {
				const made = mark(8470000 + team * 613 + i * 37, 1 + ((i * 7 + team) % 98));
				if (seen.has(made)) clashes += 1;
				seen.add(made);
			}
		}
		expect(clashes).toBeLessThanOrEqual(1);
	});
});

describe('rosterMarks', () => {
	it('has one mark for each player with a number, and none for the rest', () => {
		const marks = rosterMarks([
			{ id: 1, sweaterNumber: 9 },
			{ id: 2, sweaterNumber: null },
			{ id: 3, sweaterNumber: 30 }
		]);

		expect(marks).toBe(mark(1, 9) + mark(3, 30));
		expect(rosterMarks([])).toBe('');
	});
});

describe('who on a roster is new', () => {
	const roster = [
		{ id: 1, sweaterNumber: 9 },
		{ id: 2, sweaterNumber: 19 },
		{ id: 3, sweaterNumber: 30 },
		{ id: 4, sweaterNumber: null }
	];
	const marks = rosterMarks(roster);

	/** Someone who has played the team to the end, naming these players on the way. */
	function finished(known: [number, number][]): Records {
		let records = recordRun(emptyRecords(), TEAM, SEASON, { level: 'easy', found: 3, total: 3 });
		for (const [id, sweaterNumber] of known)
			records = recordKnown(records, TEAM, id, sweaterNumber);
		return records;
	}

	it('is nobody on a team that has never been played to the end, where everyone would be', () => {
		expect(newCount(emptyRecords(), TEAM, marks)).toBe(0);
		expect(newPlayers(emptyRecords(), TEAM, roster)).toEqual([]);

		// Named a couple along the way, but never finished.
		const partway = recordKnown(recordKnown(emptyRecords(), TEAM, 1, 9), TEAM, 2, 19);
		expect(newCount(partway, TEAM, marks)).toBe(0);
		expect(newPlayers(partway, TEAM, roster)).toEqual([]);
	});

	it('is nobody when every player on the roster has been named', () => {
		const records = finished([
			[1, 9],
			[2, 19],
			[3, 30]
		]);

		expect(newCount(records, TEAM, marks)).toBe(0);
		expect(newPlayers(records, TEAM, roster)).toEqual([]);
	});

	it('is whoever has arrived or changed number since, and never a player with no number', () => {
		// Player 2 wore 91 when they were named; player 3 had not arrived.
		const records = finished([
			[1, 9],
			[2, 91]
		]);

		expect(newCount(records, TEAM, marks)).toBe(2);
		expect(newPlayers(records, TEAM, roster).map((p) => p.id)).toEqual([2, 3]);
	});

	it('is not thrown by players who have left', () => {
		const records = finished([
			[1, 9],
			[2, 19],
			[3, 30],
			[77, 77]
		]);

		expect(newCount(records, TEAM, marks)).toBe(0);
	});

	it('is counted for one team at a time', () => {
		const records = finished([[1, 9]]);

		expect(newCount(records, 'nhl:MTL', marks)).toBe(0);
		expect(newPlayers(records, 'nhl:MTL', roster)).toEqual([]);
	});

	it('goes on being counted in a new season', () => {
		const records = finished([[1, 9]]);
		const later = recordRun(records, 'nhl:MTL', SEASON + 1, { level: 'easy', found: 1, total: 1 });

		expect(newCount(later, TEAM, marks)).toBe(2);
	});
});
