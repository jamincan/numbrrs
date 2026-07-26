import { describe, expect, it } from 'vitest';
import { nextQuestion, preIdentifiedIds, shuffle, type GamePlayer } from './game';

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

describe('nextQuestion', () => {
	it('asks about a player who has not been identified', () => {
		for (let seed = 1; seed < 20; seed++) {
			const q = nextQuestion(roster, [1, 2, 3], 4, seeded(seed));
			expect([4, 5, 6]).toContain(q.player.id);
		}
	});

	it('includes the asked player among the options', () => {
		for (let seed = 1; seed < 20; seed++) {
			const q = nextQuestion(roster, [], 4, seeded(seed));
			expect(q.optionIds).toContain(q.player.id);
		}
	});

	it('offers as many options as the difficulty allows', () => {
		const q = nextQuestion(roster, [], 4, seeded());
		expect(q.optionIds).toHaveLength(4);
	});

	it('offers every remaining player on expert difficulty', () => {
		const q = nextQuestion(roster, [1], Infinity, seeded());
		expect([...q.optionIds].sort()).toEqual([2, 3, 4, 5, 6]);
	});

	it('caps the options at the remaining player count', () => {
		const q = nextQuestion(roster, [1, 2, 3, 4], 8, seeded());
		expect([...q.optionIds].sort()).toEqual([5, 6]);
	});

	it('never repeats an option', () => {
		for (let seed = 1; seed < 20; seed++) {
			const q = nextQuestion(roster, [], 4, seeded(seed));
			expect(new Set(q.optionIds).size).toBe(q.optionIds.length);
		}
	});

	it('never offers an already-identified player', () => {
		for (let seed = 1; seed < 20; seed++) {
			const q = nextQuestion(roster, [2, 4], 8, seeded(seed));
			expect(q.optionIds).not.toContain(2);
			expect(q.optionIds).not.toContain(4);
		}
	});
});
