import { describe, expect, it } from 'vitest';
import { isPlayable } from '#lib/game.ts';
import { GameState } from '#lib/game-state.svelte.ts';
import type { Player } from '#lib/types.ts';

// Vitest runs in Node, so vite-plugin-svelte compiles game-state.svelte.ts the
// way it does for server rendering: `$state` fields are plain properties, and
// `browser` from $app/env is false. So a GameState built here never touches
// localStorage, and nothing in this file covers the difficulty being saved —
// e2e/game.spec.ts does that in a real browser.
//
// The deck is shuffled with the real Math.random. Each test reads the card that
// came up and answers it, so none of them depend on the order.

function player(id: number, sweaterNumber: number | null = id): Player {
	return {
		league: 'nhl',
		id,
		teamId: 'nhl:TST',
		firstName: `First${id}`,
		lastName: `Last${id}`,
		sweaterNumber,
		positionCode: 'C',
		headshotUrl: ''
	};
}

const ids = (players: Player[]) => players.map((p) => p.id);
const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

/** The card that's up. Fails the test, rather than the type check, if the game is over. */
function current(game: GameState) {
	if (!game.current) throw new Error('Expected a card to be up, but the game is over');
	return game.current;
}

/** Answer every card with its own player until none are left. */
function finish(game: GameState) {
	// Far more turns than any roster here needs; a game that never ends should
	// fail the test, not hang it.
	for (let turn = 0; game.current && turn < 1000; turn++) game.guess(game.current.player.id);
}

describe('a new game', () => {
	it('puts a numbered player up with their options, at the easy default', () => {
		const roster = [player(1), player(2), player(3), player(4)];
		const game = new GameState(roster);

		const card = current(game);
		expect(ids(roster)).toContain(card.player.id);
		expect(card.optionIds).toHaveLength(2);
		expect(card.optionIds).toContain(card.player.id);
		expect(ids(game.activeOptions)).toEqual(card.optionIds);
		expect(game.deck).toHaveLength(3);
		expect(ids(game.deck)).not.toContain(card.player.id);
		expect(game.guesses).toBe(0);
		expect(game.identified).toEqual([]);
		expect(game.resolved).toBeNull();
		expect(game.previous).toBeNull();
	});

	it('starts players without a number as already identified, and never asks about them', () => {
		const game = new GameState([player(1), player(2, null), player(3), player(4, null)]);

		expect(game.identified).toEqual([2, 4]);
		expect(game.rosterLength).toBe(4);
		expect(game.guessableCount).toBe(2);
		expect([1, 3]).toContain(current(game).player.id);
		expect(ascending(current(game).optionIds)).toEqual([1, 3]);
	});
});

describe('guess', () => {
	it('identifies the player on a right guess and turns their card onto the pile', () => {
		const game = new GameState([player(1), player(2), player(3)]);
		const first = current(game);

		game.guess(first.player.id);

		expect(game.identified).toEqual([first.player.id]);
		expect(game.guesses).toBe(1);
		expect(game.resolved).toEqual({ key: first.key, player: first.player, correct: true });
		expect(game.previous).toBeNull();

		const second = current(game);
		expect(second.key).not.toBe(first.key);
		expect(second.player.id).not.toBe(first.player.id);
		expect(second.optionIds).not.toContain(first.player.id);

		game.guess(second.player.id);

		// The pile keeps the card before last, for the one landing on top of it.
		expect(game.previous).toEqual({ key: first.key, player: first.player, correct: true });
		expect(game.resolved).toEqual({ key: second.key, player: second.player, correct: true });
	});

	it('recycles a wrongly guessed card until its player is found', () => {
		const roster = [player(1), player(2)];
		const game = new GameState(roster);
		const missed = current(game).player;
		const other = roster.find((p) => p.id !== missed.id)!;

		game.guess(other.id);

		// The card shows who it was, not who was picked, and nobody is identified.
		expect(game.resolved).toMatchObject({ player: missed, correct: false });
		expect(game.identified).toEqual([]);
		expect(game.guesses).toBe(1);
		expect(game.recycle).toEqual([missed]);
		expect(current(game).player.id).toBe(other.id);

		game.guess(other.id);

		// The draw pile is empty, so the missed card comes back instead of the
		// game ending.
		expect(current(game).player.id).toBe(missed.id);
		expect(game.recycle).toEqual([]);

		game.guess(missed.id);

		expect(game.current).toBeNull();
		expect(ascending(game.identified)).toEqual([1, 2]);
		expect(game.guesses).toBe(3);
	});

	it('gives every card its own key, including a recycled one', () => {
		const roster = [player(1), player(2), player(3)];
		const game = new GameState(roster);
		const keys = new Set<number>();

		// Miss every card once, then answer them all.
		for (let turn = 0; turn < 3; turn++) {
			const card = current(game);
			keys.add(card.key);
			game.guess(roster.find((p) => p.id !== card.player.id)!.id);
		}
		while (game.current) {
			keys.add(game.current.key);
			game.guess(game.current.player.id);
		}

		expect(keys.size).toBe(game.guesses);
	});

	it('accepts either wearer of a shared number, identifying only the one picked', () => {
		const a = player(1, 11);
		const b = player(2, 11);
		const game = new GameState([a, b, player(3, 7), player(4, 8)]);

		// Answer whatever else comes up until an 11 is on the card.
		while (current(game).player.sweaterNumber !== 11) game.guess(current(game).player.id);
		const asked = current(game).player;
		const twin = asked.id === a.id ? b : a;
		const guessesBefore = game.guesses;

		game.guess(twin.id);

		// Right, and the card turns over as the player who was picked.
		expect(game.resolved).toMatchObject({ player: twin, correct: true });
		expect(game.guesses).toBe(guessesBefore + 1);
		expect(game.identified).toContain(twin.id);
		expect(game.identified).not.toContain(asked.id);

		// The twin's own card is done wherever it was; the one that was asked
		// about still has to be found.
		const remaining = ids([...game.deck, ...game.recycle, current(game).player]);
		expect(remaining).not.toContain(twin.id);
		expect(remaining).toContain(asked.id);

		finish(game);

		expect(ascending(game.identified)).toEqual([1, 2, 3, 4]);
	});

	it('still counts a different number as wrong when the roster has a shared one', () => {
		const seven = player(3, 7);
		const game = new GameState([player(1, 11), player(2, 11), seven]);

		while (current(game).player.id !== seven.id) game.guess(current(game).player.id);
		game.guess(1);

		expect(game.resolved).toMatchObject({ player: seven, correct: false });
		expect(game.identified).not.toContain(seven.id);
	});
});

describe('the end of the deck', () => {
	it('ends the game once everyone is identified, and ignores guesses after that', () => {
		const game = new GameState([player(1), player(2), player(3), player(4, null)]);

		finish(game);

		expect(game.current).toBeNull();
		expect(game.activeOptions).toEqual([]);
		expect(game.deck).toEqual([]);
		expect(game.recycle).toEqual([]);
		expect(ascending(game.identified)).toEqual([1, 2, 3, 4]);
		expect(game.guesses).toBe(game.guessableCount);

		const last = game.resolved;
		game.guess(1);

		expect(game.guesses).toBe(3);
		expect(game.resolved).toEqual(last);
	});

	it('deals a fresh game on reset, without reusing a card key', () => {
		const game = new GameState([player(1), player(2), player(3, null)]);
		finish(game);
		const lastKey = game.resolved!.key;

		game.reset();

		expect(game.guesses).toBe(0);
		expect(game.identified).toEqual([3]);
		expect(game.resolved).toBeNull();
		expect(game.previous).toBeNull();
		expect(game.deck).toHaveLength(1);
		expect(current(game).key).toBeGreaterThan(lastKey);
	});
});

describe('a roster where nobody has a number', () => {
	const roster = [player(1, null), player(2, null)];

	it('is not playable, which is what keeps the page from starting a game with it', () => {
		expect(isPlayable(roster)).toBe(false);
		expect(isPlayable([])).toBe(false);
		expect(isPlayable([...roster, player(3)])).toBe(true);
	});

	it('has no card to deal, before or after a reset, rather than failing to build one', () => {
		const game = new GameState(roster);

		expect(game.current).toBeNull();
		expect(game.guessableCount).toBe(0);
		expect(game.identified).toEqual([1, 2]);

		game.guess(1);
		expect(game.guesses).toBe(0);

		game.reset();
		expect(game.current).toBeNull();
		expect(game.activeOptions).toEqual([]);
	});
});

describe('setDifficulty', () => {
	it('re-deals the options around the same card', () => {
		const roster = [player(1), player(2), player(3), player(4), player(5), player(6)];
		const game = new GameState(roster);
		const before = current(game);

		game.setDifficulty(Infinity);

		expect(game.difficulty).toBe(Infinity);
		expect(current(game).key).toBe(before.key);
		expect(current(game).player.id).toBe(before.player.id);
		expect(ascending(current(game).optionIds)).toEqual([1, 2, 3, 4, 5, 6]);

		game.setDifficulty(4);

		expect(current(game).key).toBe(before.key);
		expect(current(game).optionIds).toHaveLength(4);
		expect(current(game).optionIds).toContain(before.player.id);
	});

	it('leaves out players who are already identified', () => {
		const game = new GameState([player(1), player(2), player(3), player(4)]);
		const found = current(game).player;
		game.guess(found.id);

		game.setDifficulty(Infinity);

		expect(current(game).optionIds).toHaveLength(3);
		expect(current(game).optionIds).not.toContain(found.id);
	});

	it('applies to the cards that follow', () => {
		const game = new GameState([player(1), player(2), player(3), player(4), player(5)]);
		game.setDifficulty(4);

		game.guess(current(game).player.id);

		expect(current(game).optionIds).toHaveLength(4);
	});

	it('is remembered once the game is over, with no card to re-deal', () => {
		const game = new GameState([player(1)]);
		finish(game);

		game.setDifficulty(8);

		expect(game.difficulty).toBe(8);
		expect(game.current).toBeNull();
	});
});
