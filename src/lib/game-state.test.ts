import { describe, expect, it } from 'vitest';
import { isPlayable } from '#lib/game.ts';
import { GameState, saveKey, type GameStorage } from '#lib/game-state.svelte.ts';
import type { Player } from '#lib/types.ts';

// Vitest runs in Node, so vite-plugin-svelte compiles game-state.svelte.ts the
// way it does for server rendering: `$state` fields are plain properties, and
// `browser` from $app/env is false. So a GameState built here never touches
// localStorage, and nothing in this file covers the difficulty being saved —
// e2e/game.spec.ts does that in a real browser. The saved game is covered
// here, because its storage is handed in rather than reached for.
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

/** A game with its first card up. Construction alone deals nothing: the page
 *  does that once it has mounted. */
function newGame(roster: Player[]): GameState {
	const game = new GameState(roster);
	game.reset();
	return game;
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

describe('before the first deal', () => {
	it('has shuffled nothing, so the server and every visitor start from the same markup', () => {
		const game = new GameState([player(1), player(2), player(3, null)]);

		expect(game.dealt).toBe(false);
		expect(game.current).toBeNull();
		expect(game.deck).toEqual([]);
		expect(game.activeOptions).toEqual([]);
		// Already right for the progress line.
		expect(game.identified).toEqual([3]);
		expect(game.rosterLength).toBe(3);

		// Nothing to guess at or re-deal yet.
		game.guess(1);
		game.setDifficulty(4);
		expect(game.guesses).toBe(0);
		expect(game.current).toBeNull();

		game.reset();
		expect(game.dealt).toBe(true);
		expect([1, 2]).toContain(current(game).player.id);
	});
});

describe('a new game', () => {
	it('puts a numbered player up with their options, at the easy default', () => {
		const roster = [player(1), player(2), player(3), player(4)];
		const game = newGame(roster);

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
		const game = newGame([player(1), player(2, null), player(3), player(4, null)]);

		expect(game.identified).toEqual([2, 4]);
		expect(game.rosterLength).toBe(4);
		expect(game.guessableCount).toBe(2);
		expect([1, 3]).toContain(current(game).player.id);
		expect(ascending(current(game).optionIds)).toEqual([1, 3]);
	});
});

describe('guess', () => {
	it('identifies the player on a right guess and turns their card onto the pile', () => {
		const game = newGame([player(1), player(2), player(3)]);
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
		const game = newGame(roster);
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
		const game = newGame(roster);
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
		const game = newGame([a, b, player(3, 7), player(4, 8)]);

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
		const game = newGame([player(1, 11), player(2, 11), seven]);

		while (current(game).player.id !== seven.id) game.guess(current(game).player.id);
		game.guess(1);

		expect(game.resolved).toMatchObject({ player: seven, correct: false });
		expect(game.identified).not.toContain(seven.id);
	});
});

describe('the end of the deck', () => {
	it('ends the game once everyone is identified, and ignores guesses after that', () => {
		const game = newGame([player(1), player(2), player(3), player(4, null)]);

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
		const game = newGame([player(1), player(2), player(3, null)]);
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
		const game = newGame(roster);

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
		const game = newGame(roster);
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
		const game = newGame([player(1), player(2), player(3), player(4)]);
		const found = current(game).player;
		game.guess(found.id);

		game.setDifficulty(Infinity);

		expect(current(game).optionIds).toHaveLength(3);
		expect(current(game).optionIds).not.toContain(found.id);
	});

	it('applies to the cards that follow', () => {
		const game = newGame([player(1), player(2), player(3), player(4), player(5)]);
		game.setDifficulty(4);

		game.guess(current(game).player.id);

		expect(current(game).optionIds).toHaveLength(4);
	});

	it('is remembered once the game is over, with no card to re-deal', () => {
		const game = newGame([player(1)]);
		finish(game);

		game.setDifficulty(8);

		expect(game.difficulty).toBe(8);
		expect(game.current).toBeNull();
	});
});

describe('a saved game', () => {
	const TEAM = 'nhl:TST';
	const KEY = saveKey(TEAM);
	const roster = () => [player(1), player(2), player(3), player(4), player(5), player(6, null)];

	/** sessionStorage, as far as the game uses it. */
	function memoryStorage(initial: Record<string, string> = {}) {
		const items = new Map(Object.entries(initial));
		const storage: GameStorage = {
			getItem: (key) => items.get(key) ?? null,
			setItem: (key, value) => void items.set(key, value),
			removeItem: (key) => void items.delete(key)
		};
		return { storage, items };
	}

	/** A game two guesses in — one right, one wrong — and saved. */
	function midGame() {
		const { storage, items } = memoryStorage();
		const game = newGame(roster());
		game.guess(current(game).player.id);
		const missed = current(game);
		game.guess(missed.optionIds.find((id) => id !== missed.player.id)!);
		game.save(storage, TEAM);
		return { storage, items, game };
	}

	/** What a restore has to bring back. Card keys are per instance, and the
	 *  guessed pile is deliberately not kept. */
	function snapshot(game: GameState) {
		return {
			identified: [...game.identified],
			guesses: game.guesses,
			deck: ids(game.deck),
			recycle: ids(game.recycle),
			current: game.current && {
				player: game.current.player.id,
				optionIds: [...game.current.optionIds]
			}
		};
	}

	type Stored = {
		identified: number[];
		deck: number[];
		recycle: number[];
		current: { id: number; options: number[] };
	};
	type Change = Record<string, unknown> | ((stored: Stored) => Record<string, unknown>);

	/** The stored game with some of it replaced, as JSON. */
	function tampered(items: Map<string, string>, change: Change): string {
		const stored = JSON.parse(items.get(KEY)!) as Stored;
		return JSON.stringify({
			...stored,
			...(typeof change === 'function' ? change(stored) : change)
		});
	}

	it('comes back as it was left, mid-game', () => {
		const { storage, game } = midGame();
		expect(game.recycle).toHaveLength(1);

		const restored = new GameState(roster());
		expect(restored.restore(storage, TEAM)).toBe(true);

		expect(restored.dealt).toBe(true);
		expect(snapshot(restored)).toEqual(snapshot(game));
		expect(restored.guesses).toBe(2);
		expect(ids(restored.activeOptions)).toEqual(current(game).optionIds);

		// And it plays on to the end from there.
		finish(restored);
		expect(ascending(restored.identified)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('does not bring back the last guess, which would be announced as though just made', () => {
		const { storage, game } = midGame();
		expect(game.resolved).not.toBeNull();

		const restored = new GameState(roster());
		restored.restore(storage, TEAM);

		expect(restored.resolved).toBeNull();
		expect(restored.previous).toBeNull();
	});

	it('comes back finished when it was finished', () => {
		const { storage, game } = midGame();
		finish(game);
		game.save(storage, TEAM);

		const restored = new GameState(roster());
		expect(restored.restore(storage, TEAM)).toBe(true);

		expect(restored.dealt).toBe(true);
		expect(restored.current).toBeNull();
		expect(restored.deck).toEqual([]);
		expect(restored.recycle).toEqual([]);
		expect(ascending(restored.identified)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(restored.guesses).toBe(game.guesses);
	});

	it('is kept per team', () => {
		const { storage } = midGame();

		expect(new GameState(roster()).restore(storage, 'nhl:OTHER')).toBe(false);
	});

	it('holds nothing until a guess is made, and nothing again after Play Again', () => {
		const { storage, items } = memoryStorage();
		const game = newGame(roster());

		game.save(storage, TEAM);
		expect(items.size).toBe(0);

		game.guess(current(game).player.id);
		game.save(storage, TEAM);
		expect(items.has(KEY)).toBe(true);

		game.reset();
		game.save(storage, TEAM);
		expect(items.size).toBe(0);
	});

	it('is not written before the first deal', () => {
		const { storage, items } = midGame();
		const before = items.get(KEY);

		new GameState(roster()).save(storage, TEAM);

		expect(items.get(KEY)).toBe(before);
	});

	it('re-deals the answers when the difficulty has changed since it was saved', () => {
		const { storage, game } = midGame();

		const restored = new GameState(roster());
		restored.difficulty = 4;
		expect(restored.restore(storage, TEAM)).toBe(true);

		expect(current(restored).player.id).toBe(current(game).player.id);
		expect(current(restored).optionIds).toHaveLength(4);
		expect(current(restored).optionIds).toContain(current(game).player.id);
	});

	it.each([
		['text that is not JSON', '{"v":1,"identified":['],
		['JSON that is not a game', '"numbrrs"'],
		['null', 'null'],
		['an empty object', '{}']
	])('is dropped when storage holds %s', (_name, value) => {
		const { storage, items } = memoryStorage({ [KEY]: value });

		const game = new GameState(roster());
		expect(game.restore(storage, TEAM)).toBe(false);

		expect(game.dealt).toBe(false);
		expect(items.has(KEY)).toBe(false);
	});

	it.each<[string, Change]>([
		['another version', { v: 2 }],
		['no version', { v: undefined }],
		['a guess count that is not a count', { guesses: '2' }],
		['a negative guess count', { guesses: -1 }],
		['fewer guesses than players found', { guesses: 0 }],
		['a pile that is not a list', { deck: 'all of them' }],
		['ids that are not numbers', { recycle: ['3'] }],
		['a player missing from every pile', { deck: [] }],
		['a player in two places', { identified: [1, 2, 3, 4, 5, 6] }],
		['a player who is not on the roster', { recycle: [99] }],
		[
			'a numberless player in the deck',
			({ identified, deck }) => ({
				identified: identified.filter((id) => id !== 6),
				deck: [...deck, 6]
			})
		],
		[
			'no card up while cards remain',
			({ deck, current }) => ({ deck: [current.id, ...deck], current: null })
		],
		['a card that is not a card', { current: 3 }],
		['a card without its own player among the answers', { current: { id: 1, options: [] } }]
	])('is dropped when it has %s', (_name, change) => {
		const { storage, items } = midGame();
		items.set(KEY, tampered(items, change));

		const game = new GameState(roster());
		expect(game.restore(storage, TEAM)).toBe(false);

		expect(game.dealt).toBe(false);
		expect(game.guesses).toBe(0);
		expect(game.identified).toEqual([6]);
		expect(items.has(KEY)).toBe(false);
	});

	it('is dropped when an answer on the card is someone already identified', () => {
		const { storage, items, game } = midGame();
		const found = game.identified.find((id) => id !== 6)!;
		const card = current(game);
		items.set(
			KEY,
			tampered(items, { current: { id: card.player.id, options: [card.player.id, found] } })
		);

		expect(new GameState(roster()).restore(storage, TEAM)).toBe(false);
		expect(items.has(KEY)).toBe(false);
	});

	it.each<[string, () => Player[]]>([
		['a player has left', () => roster().slice(1)],
		['a player has arrived', () => [...roster(), player(7)]],
		['a player has changed number', () => roster().map((p) => (p.id === 2 ? player(2, 22) : p))],
		['a numberless player has been given one', () => [...roster().slice(0, 5), player(6, 66)]]
	])('is dropped when %s since it was saved', (_name, changed) => {
		const { storage, items } = midGame();

		const game = new GameState(changed());
		expect(game.restore(storage, TEAM)).toBe(false);

		expect(game.dealt).toBe(false);
		expect(items.has(KEY)).toBe(false);
	});

	it('survives a roster that only changed order', () => {
		const { storage } = midGame();

		expect(new GameState(roster().reverse()).restore(storage, TEAM)).toBe(true);
	});

	it('costs nothing but the saved game when storage throws', () => {
		const blocked = () => {
			throw new DOMException('The operation is insecure.', 'SecurityError');
		};
		const storage: GameStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };

		const game = new GameState(roster());
		expect(game.restore(storage, TEAM)).toBe(false);
		game.reset();
		game.save(storage, TEAM);
		game.guess(current(game).player.id);
		expect(() => game.save(storage, TEAM)).not.toThrow();

		expect(game.guesses).toBe(1);
		expect(game.current).not.toBeNull();
	});

	it('is skipped quietly when there is no storage at all', () => {
		const game = new GameState(roster());

		expect(game.restore(null, TEAM)).toBe(false);
		game.reset();
		game.guess(current(game).player.id);
		expect(() => game.save(null, TEAM)).not.toThrow();
	});
});
