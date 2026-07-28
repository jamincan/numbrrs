import { describe, expect, it } from 'vitest';
import {
	buildDeck,
	cardOptions,
	drawCard,
	preIdentifiedIds,
	shuffle,
	type GamePlayer
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
		const drawn = drawCard(roster, [], seeded());
		expect(drawn?.player.id).toBe(1);
		expect(drawn?.deck.map((p) => p.id)).toEqual([2, 3, 4, 5, 6]);
		expect(drawn?.recycle).toEqual([]);
	});

	it('leaves the recycle pile alone while the deck holds cards', () => {
		const drawn = drawCard([player(1)], [player(2)], seeded());
		expect(drawn?.player.id).toBe(1);
		expect(drawn?.recycle.map((p) => p.id)).toEqual([2]);
	});

	it('shuffles the recycle pile into a fresh deck once the draw pile empties', () => {
		const recycle = [player(1), player(2), player(3)];
		const drawn = drawCard([], recycle, seeded());
		expect(drawn).not.toBeNull();
		expect(drawn!.recycle).toEqual([]);
		expect([drawn!.player.id, ...drawn!.deck.map((p) => p.id)].sort()).toEqual([1, 2, 3]);
	});

	it('returns null when both piles are exhausted', () => {
		expect(drawCard([], [], seeded())).toBeNull();
	});

	it('does not mutate its inputs', () => {
		const deck = [player(1), player(2)];
		const recycle = [player(3)];
		drawCard(deck, recycle, seeded());
		drawCard([], recycle, seeded());
		expect(deck.map((p) => p.id)).toEqual([1, 2]);
		expect(recycle.map((p) => p.id)).toEqual([3]);
	});
});

describe('cardOptions', () => {
	it('includes the drawn player', () => {
		for (let seed = 1; seed < 20; seed++) {
			expect(cardOptions(roster, [], roster[2]!, 4, seeded(seed))).toContain(3);
		}
	});

	it('offers as many options as the difficulty allows', () => {
		expect(cardOptions(roster, [], roster[0]!, 4, seeded())).toHaveLength(4);
	});

	it('offers every remaining player on expert difficulty', () => {
		expect([...cardOptions(roster, [1], roster[1]!, Infinity, seeded())].sort()).toEqual([
			2, 3, 4, 5, 6
		]);
	});

	it('caps the options at the remaining player count', () => {
		expect([...cardOptions(roster, [1, 2, 3, 4], roster[4]!, 8, seeded())].sort()).toEqual([5, 6]);
	});

	it('never repeats an option', () => {
		for (let seed = 1; seed < 20; seed++) {
			const options = cardOptions(roster, [], roster[0]!, 4, seeded(seed));
			expect(new Set(options).size).toBe(options.length);
		}
	});

	it('never offers an already-identified player', () => {
		for (let seed = 1; seed < 20; seed++) {
			const options = cardOptions(roster, [2, 4], roster[0]!, 8, seeded(seed));
			expect(options).not.toContain(2);
			expect(options).not.toContain(4);
		}
	});
});
