import { describe, expect, it } from 'vitest';
import {
	buildDeck,
	cardOptions,
	drawCard,
	isLevelKey,
	isPlayable,
	LEVELS,
	learnOptions,
	levelFor,
	lowerLevel,
	preIdentifiedIds,
	reinsertCard,
	REINSERT_MAX,
	REINSERT_MIN,
	rosterOrder,
	shuffle,
	type GamePlayer,
	type Level
} from './game';

/** Deterministic stand-in for Math.random. */
function seeded(seed = 1): () => number {
	let s = seed;
	return () => {
		s = (s * 16807) % 2147483647;
		return (s - 1) / 2147483646;
	};
}

function player(id: number, sweaterNumber: number | null = id): GamePlayer {
	return { id, sweaterNumber };
}

const roster = [player(1), player(2), player(3), player(4), player(5), player(6)];

describe('shuffle', () => {
	it('keeps every element', () => {
		const items = [1, 2, 3, 4, 5];
		expect([...shuffle(items, seeded())].sort()).toEqual([1, 2, 3, 4, 5]);
	});

	it('handles empty and single-element arrays', () => {
		expect(shuffle([], seeded())).toEqual([]);
		expect(shuffle([7], seeded())).toEqual([7]);
	});
});

describe('preIdentifiedIds', () => {
	it('returns players without a sweater number', () => {
		const mixed = [player(1, 10), player(2, null), player(3, null), player(4, 4)];
		expect(preIdentifiedIds(mixed)).toEqual([2, 3]);
	});

	it('is empty when everyone has a number', () => {
		expect(preIdentifiedIds(roster)).toEqual([]);
	});
});

describe('isPlayable', () => {
	it('needs at least one player with a number', () => {
		expect(isPlayable(roster)).toBe(true);
		expect(isPlayable([player(1, null), player(2, 22)])).toBe(true);
	});

	it('is false for a numberless or empty roster', () => {
		expect(isPlayable([player(1, null), player(2, null)])).toBe(false);
		expect(isPlayable([])).toBe(false);
	});
});

describe('buildDeck', () => {
	it('deals one card per player, shuffled', () => {
		const deck = buildDeck(roster, seeded());
		expect(deck.map((p) => p.id).sort()).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('deals no cards for numberless players', () => {
		const mixed = [player(1, 10), player(2, null), player(3, 30)];
		expect(
			buildDeck(mixed, seeded())
				.map((p) => p.id)
				.sort()
		).toEqual([1, 3]);
	});

	it('is empty for a roster with nobody to guess', () => {
		expect(buildDeck([player(1, null), player(2, null)], seeded())).toEqual([]);
	});
});

describe('drawCard', () => {
	it('draws the top card and leaves the rest', () => {
		const drawn = drawCard(roster);
		expect(drawn?.card.id).toBe(1);
		expect(drawn?.deck.map((p) => p.id)).toEqual([2, 3, 4, 5, 6]);
	});

	it('returns null when the pile is empty', () => {
		expect(drawCard([])).toBeNull();
	});

	it('does not mutate its input', () => {
		const deck = [player(1), player(2)];
		drawCard(deck);
		expect(deck.map((p) => p.id)).toEqual([1, 2]);
	});
});

describe('reinsertCard', () => {
	const deck = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => player(id));
	const missed = player(99);

	it('puts the card back a few cards down, never on top and never out of reach', () => {
		// One generator across every draw: the stand-in's first value is close
		// to zero for any small seed, so a fresh one each time would only ever
		// show the shortest gap.
		const random = seeded();
		const gaps = new Set<number>();
		for (let draw = 0; draw < 60; draw++) {
			const next = reinsertCard(deck, missed, random);
			expect(next).toHaveLength(deck.length + 1);
			// Everyone else keeps their order around it.
			expect(next.filter((p) => p.id !== 99).map((p) => p.id)).toEqual(deck.map((p) => p.id));
			gaps.add(next.findIndex((p) => p.id === 99));
		}
		expect(Math.min(...gaps)).toBe(REINSERT_MIN);
		expect(Math.max(...gaps)).toBe(REINSERT_MAX);
	});

	it('takes a shorter gap when asked for one', () => {
		const random = seeded();
		const gaps = new Set<number>();
		for (let draw = 0; draw < 60; draw++) {
			gaps.add(reinsertCard(deck, missed, random, 2, 3).findIndex((p) => p.id === 99));
		}
		expect([...gaps].sort()).toEqual([2, 3]);
	});

	it('goes to the bottom of a pile shorter than the gap', () => {
		for (let seed = 1; seed < 20; seed++) {
			const next = reinsertCard([player(1), player(2)], missed, seeded(seed));
			expect(next.map((p) => p.id)).toEqual([1, 2, 99]);
		}
		expect(reinsertCard([], missed, seeded()).map((p) => p.id)).toEqual([99]);
	});

	it('does not mutate its input', () => {
		const pile = [player(1), player(2), player(3), player(4)];
		reinsertCard(pile, missed, seeded());
		expect(pile.map((p) => p.id)).toEqual([1, 2, 3, 4]);
	});
});

describe('levels', () => {
	it('run from Learn up to Hard, and only the quiz levels carry a medal', () => {
		expect(LEVELS.map((level) => [level.key, level.choices, level.medal])).toEqual([
			['learn', 3, null],
			['easy', 5, 'bronze'],
			['medium', 10, 'silver'],
			['hard', Infinity, 'gold']
		]);
		expect(LEVELS.filter((level) => !level.closedBook).map((level) => level.key)).toEqual([
			'learn'
		]);
	});

	it('are recognised by key, and nothing else is', () => {
		expect(isLevelKey('medium')).toBe(true);
		expect(isLevelKey('expert')).toBe(false);
		expect(isLevelKey(4)).toBe(false);
		expect(isLevelKey(null)).toBe(false);
	});

	it('compare by difficulty', () => {
		expect(lowerLevel('hard', 'easy')).toBe('easy');
		expect(lowerLevel('easy', 'hard')).toBe('easy');
		expect(lowerLevel('medium', 'medium')).toBe('medium');
	});
});

describe('rosterOrder', () => {
	const skater = (
		id: number,
		lastName: string,
		positionCode: string,
		sweaterNumber: number,
		firstName = 'A'
	) => ({ id, firstName, lastName, positionCode, sweaterNumber });

	it('groups by position, then sorts by name, whatever order the feed used', () => {
		// As a league might send it: by sweater number.
		const feed = [
			skater(1, 'Zed', 'G', 1),
			skater(2, 'Young', 'D', 2),
			skater(3, 'Abel', 'D', 3),
			skater(4, 'Moore', 'C', 9, 'Brad'),
			skater(5, 'Baker', 'R', 10),
			skater(6, 'Moore', 'L', 11, 'Aaron'),
			skater(7, 'Coach', 'X', 12),
			skater(8, 'Adams', 'G', 30)
		];
		expect(rosterOrder(feed).map((p) => p.id)).toEqual([5, 6, 4, 3, 2, 8, 1, 7]);
	});

	it('ignores case and accents, so a name sorts where a reader would look for it', () => {
		const accented = String.fromCharCode(0xc9) + 'mond';
		const names = ['van Dyk', 'Zetterberg', accented, 'Eller', 'de Haan', 'Daigle'];
		const ordered = rosterOrder(names.map((lastName, i) => skater(i, lastName, 'C', i)));
		expect(ordered.map((p) => p.lastName)).toEqual([
			'Daigle',
			'de Haan',
			'Eller',
			accented,
			'van Dyk',
			'Zetterberg'
		]);
	});

	it('does not mutate its input', () => {
		const feed = [skater(1, 'Zed', 'C', 1), skater(2, 'Abel', 'C', 2)];
		rosterOrder(feed);
		expect(feed.map((p) => p.id)).toEqual([1, 2]);
	});
});

describe('cardOptions', () => {
	const learn = levelFor('learn');
	const easy = levelFor('easy');
	const hard = levelFor('hard');
	/** A level with its own number of choices, for the cases the real ones
	 *  don't reach on six players. */
	const offering = (choices: number, closedBook: boolean): Level => ({
		key: closedBook ? 'easy' : 'learn',
		choices,
		medal: null,
		closedBook
	});

	it('includes the drawn player', () => {
		for (let seed = 1; seed < 20; seed++) {
			expect(cardOptions(roster, [], roster[2]!, learn, seeded(seed))).toContain(3);
			expect(cardOptions(roster, [], roster[2]!, easy, seeded(seed))).toContain(3);
		}
	});

	it('offers as many options as the level allows', () => {
		expect(cardOptions(roster, [], roster[0]!, learn, seeded())).toHaveLength(3);
		expect(cardOptions(roster, [], roster[0]!, easy, seeded())).toHaveLength(5);
	});

	it('never repeats an option', () => {
		for (let seed = 1; seed < 20; seed++) {
			const options = cardOptions(roster, [], roster[0]!, easy, seeded(seed));
			expect(new Set(options).size).toBe(options.length);
		}
	});

	describe('in the open book', () => {
		it('never offers an already-identified player', () => {
			for (let seed = 1; seed < 20; seed++) {
				const options = cardOptions(roster, [2, 4], roster[0]!, learn, seeded(seed));
				expect(options).not.toContain(2);
				expect(options).not.toContain(4);
			}
		});

		it('caps the options at the players still to be found', () => {
			expect([...cardOptions(roster, [1, 2, 3, 4], roster[4]!, learn, seeded())].sort()).toEqual([
				5, 6
			]);
		});

		it('shuffles even when it offers everyone left', () => {
			const orders = new Set<string>();
			for (let seed = 1; seed < 20; seed++) {
				orders.add(
					cardOptions(roster, [], roster[0]!, offering(Infinity, false), seeded(seed)).join()
				);
			}
			expect(orders.size).toBeGreaterThan(1);
		});
	});

	describe('in a closed book', () => {
		it('goes on offering players who have been found, so the last card is as hard as the first', () => {
			const found = [2, 3, 4, 5, 6];
			expect(cardOptions(roster, found, roster[0]!, easy, seeded())).toHaveLength(5);

			const random = seeded();
			const offered = new Set<number>();
			for (let draw = 0; draw < 40; draw++) {
				for (const id of cardOptions(roster, found, roster[0]!, offering(3, true), random)) {
					offered.add(id);
				}
			}
			expect([...offered].sort()).toEqual([1, 2, 3, 4, 5, 6]);
		});

		it('never offers a player who has no number to be the answer', () => {
			const withBlank = [...roster, player(7, null)];
			for (let seed = 1; seed < 20; seed++) {
				expect(cardOptions(withBlank, [7], roster[0]!, easy, seeded(seed))).not.toContain(7);
			}
			expect(cardOptions(withBlank, [7], roster[0]!, hard, seeded())).toEqual([1, 2, 3, 4, 5, 6]);
		});

		it('lists the whole roster in roster order, the same for every card', () => {
			for (let seed = 1; seed < 20; seed++) {
				expect(cardOptions(roster, [1, 5], roster[3]!, hard, seeded(seed))).toEqual([
					1, 2, 3, 4, 5, 6
				]);
			}
			// Any level, once the roster is no bigger than what it offers.
			expect(cardOptions(roster.slice(0, 4), [], roster[1]!, easy, seeded())).toEqual([1, 2, 3, 4]);
		});
	});

	it('leaves out the avoided players when other candidates can fill the options', () => {
		// Players 2 and 3 have their numbers on show from the last guess; 4-6 are
		// there to be offered instead.
		for (let seed = 1; seed < 20; seed++) {
			const options = cardOptions(roster, [], roster[0]!, learn, seeded(seed), [2, 3]);
			expect(options).not.toContain(2);
			expect(options).not.toContain(3);
		}
	});

	it('falls back to an avoided player when nobody else is left to fill the options', () => {
		// Only players 1 and 2 remain unidentified, so avoiding 2 entirely would
		// leave the question with just one option.
		const options = [...cardOptions(roster, [3, 4, 5, 6], roster[0]!, learn, seeded(), [2])].sort();
		expect(options).toEqual([1, 2]);
	});
});

describe('mix-ups and the options', () => {
	const big = Array.from({ length: 20 }, (_, i) => player(i + 1));

	it('offers a preferred player ahead of the rest', () => {
		const random = seeded();
		for (let draw = 0; draw < 30; draw++) {
			const options = cardOptions(big, [], big[0]!, levelFor('easy'), random, [], [17, 18]);
			expect(options).toHaveLength(5);
			expect(options).toContain(17);
			expect(options).toContain(18);
		}
	});

	it('still leaves a preferred player out while their number is on show', () => {
		const random = seeded();
		for (let draw = 0; draw < 30; draw++) {
			const options = cardOptions(big, [], big[0]!, levelFor('easy'), random, [17], [17]);
			expect(options).not.toContain(17);
		}
	});
});

describe('learnOptions', () => {
	const introduced = [player(1), player(2), player(3), player(4), player(5), player(6)];

	it('offers the card’s player and others, only from those introduced', () => {
		const random = seeded();
		const offered = new Set<number>();
		for (let draw = 0; draw < 60; draw++) {
			const options = learnOptions(introduced, introduced[1]!, 3, random);
			expect(options).toHaveLength(3);
			expect(options).toContain(2);
			expect(new Set(options).size).toBe(3);
			for (const id of options) offered.add(id);
		}
		expect([...offered].sort()).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('offers fewer when fewer have been introduced', () => {
		expect([...learnOptions(introduced.slice(0, 2), introduced[0]!, 3, seeded())].sort()).toEqual([
			1, 2
		]);
		expect(learnOptions(introduced.slice(0, 1), introduced[0]!, 3, seeded())).toEqual([1]);
	});

	it('includes the card’s player even if they are not among those passed in', () => {
		const options = learnOptions(introduced.slice(0, 2), player(9), 3, seeded());
		expect([...options].sort()).toEqual([1, 2, 9]);
	});

	it('takes a preferred player first, and an avoided one last', () => {
		const random = seeded();
		for (let draw = 0; draw < 30; draw++) {
			const options = learnOptions(introduced, introduced[0]!, 3, random, [2], [6]);
			expect(options).toContain(6);
			expect(options).not.toContain(2);
		}
	});
});
