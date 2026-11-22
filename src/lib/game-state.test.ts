import { describe, expect, it } from 'vitest';
import {
	GROUP_SIZE,
	isPlayable,
	QUIZ_AFTER_MAX,
	QUIZ_AFTER_MIN,
	REINSERT_MAX,
	REINSERT_MIN,
	REVIEWS_PER_GROUP,
	type LevelKey
} from '#lib/game.ts';
import { GameState, saveKey, type GameStorage } from '#lib/game-state.svelte.ts';
import type { Player } from '#lib/types.ts';

// Vitest runs in Node, so vite-plugin-svelte compiles game-state.svelte.ts the
// way it does for server rendering: `$state` fields are plain properties, and
// `browser` from $app/env is false. So a GameState built here never touches
// localStorage, and nothing in this file covers the level being saved —
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

const players = (count: number) => Array.from({ length: count }, (_, i) => player(i + 1));

/** A game with its first card up. Construction alone deals nothing: the page
 *  does that once it has mounted. Easy unless a level is asked for: the plain
 *  mechanics are the same at every quiz level, and Learn has tests of its own. */
function newGame(roster: Player[], level: LevelKey = 'easy'): GameState {
	const game = new GameState(roster);
	game.setLevel(level);
	game.reset();
	return game;
}

const ids = (list: Player[]) => list.map((p) => p.id);
const ascending = (values: number[]) => [...values].sort((a, b) => a - b);
/** The draw pile, top first, as the players its cards are for. */
const deckIds = (game: GameState) => game.deck.map((step) => step.player.id);

/** The card that's up. Fails the test, rather than the type check, if the game is over. */
function current(game: GameState) {
	if (!game.current) throw new Error('Expected a card to be up, but the game is over');
	return game.current;
}

/** An answer on the card that's up which is not its own player. */
function wrongAnswer(game: GameState): number {
	const card = current(game);
	const wrong = card.optionIds.find((id) => id !== card.player.id);
	if (wrong === undefined) throw new Error('Expected the card to offer a wrong answer');
	return wrong;
}

/** Deal with the card that's up the way someone who knows the roster would:
 *  move on from an introduction, answer a question with its own player. */
function advance(game: GameState) {
	const card = current(game);
	if (card.kind === 'intro') game.next();
	else game.guess(card.player.id);
}

/** Do that until the game is over. */
function finish(game: GameState) {
	// Far more turns than any roster here needs; a game that never ends should
	// fail the test, not hang it.
	for (let turn = 0; game.current && turn < 2000; turn++) advance(game);
}

/** Do that until something is true of the game, which it must become. */
function advanceUntil(game: GameState, reached: () => boolean) {
	for (let turn = 0; !reached(); turn++) {
		if (turn > 2000 || !game.current) throw new Error('The game never got there');
		advance(game);
	}
}

describe('before the first deal', () => {
	it('has shuffled nothing, so the server and every visitor start from the same markup', () => {
		const game = new GameState([player(1), player(2), player(3, null)]);

		// A first visit is to Learn.
		expect(game.level).toBe('learn');
		expect(game.dealt).toBe(false);
		expect(game.current).toBeNull();
		expect(game.deck).toEqual([]);
		expect(game.activeOptions).toEqual([]);
		// Already right for the progress line.
		expect(game.identified).toEqual([3]);
		expect(game.rosterLength).toBe(3);
		expect(game.remaining).toBe(2);
		expect(game.outcomes).toEqual([]);

		// Nothing to guess at, move on from or re-deal yet.
		game.guess(1);
		game.next();
		game.setLevel('easy');
		expect(game.guesses).toBe(0);
		expect(game.current).toBeNull();

		game.reset();
		expect(game.dealt).toBe(true);
		expect([1, 2]).toContain(current(game).player.id);
		// The level chosen beforehand is the one the game is dealt at.
		expect(game.countsAs).toBe('easy');
	});
});

describe('a new game at a quiz level', () => {
	it('puts a numbered player up with their options', () => {
		const roster = players(8);
		const game = newGame(roster);

		const card = current(game);
		expect(game.level).toBe('easy');
		expect(game.countsAs).toBe('easy');
		expect(game.phase).toBeNull();
		expect(game.closedBook).toBe(true);
		expect(card.kind).toBe('quiz');
		expect(ids(roster)).toContain(card.player.id);
		expect(card.optionIds).toHaveLength(5);
		expect(card.optionIds).toContain(card.player.id);
		expect(ids(game.activeOptions)).toEqual(card.optionIds);
		expect(game.deck).toHaveLength(7);
		expect(deckIds(game)).not.toContain(card.player.id);
		expect(game.guesses).toBe(0);
		expect(game.identified).toEqual([]);
		expect(game.missed).toEqual([]);
		expect(game.remaining).toBe(8);
		expect(game.resolved).toBeNull();
		expect(game.previous).toBeNull();
		// Nothing has been done yet, so there is nothing to announce.
		expect(game.lastMove).toBeNull();
	});

	it('starts players without a number as already identified, and never asks about them', () => {
		const game = newGame([player(1), player(2, null), player(3), player(4, null)]);

		expect(game.identified).toEqual([2, 4]);
		expect(game.rosterLength).toBe(4);
		expect(game.guessableCount).toBe(2);
		expect(game.remaining).toBe(2);
		expect([1, 3]).toContain(current(game).player.id);
		expect(ascending(current(game).optionIds)).toEqual([1, 3]);
	});
});

describe('guess', () => {
	it('identifies the player on a right guess and turns their card onto the pile', () => {
		const game = newGame(players(3));
		const first = current(game);

		game.guess(first.player.id);

		expect(game.identified).toEqual([first.player.id]);
		expect(game.guesses).toBe(1);
		expect(game.remaining).toBe(2);
		expect(game.lastMove).toBe('guess');
		expect(game.moves).toBe(1);
		expect(game.resolved).toEqual({
			key: first.key,
			player: first.player,
			correct: true,
			picked: null
		});
		expect(game.previous).toBeNull();

		const second = current(game);
		expect(second.key).not.toBe(first.key);
		expect(second.player.id).not.toBe(first.player.id);

		game.guess(second.player.id);

		// The pile keeps the card before last, for the one landing on top of it.
		expect(game.previous?.key).toBe(first.key);
		expect(game.resolved?.key).toBe(second.key);
	});

	it('sends a wrongly guessed card back into the pile a few cards down, and says who was picked', () => {
		const roster = players(12);
		const game = newGame(roster);
		const missed = current(game);
		const pickedId = wrongAnswer(game);

		game.guess(pickedId);

		expect(game.identified).toEqual([]);
		expect(game.guesses).toBe(1);
		expect(game.missed).toEqual([missed.player.id]);
		// The pile shows who does wear the number, and the page says what the
		// player who was picked wears instead.
		expect(game.resolved).toEqual({
			key: missed.key,
			player: missed.player,
			correct: false,
			picked: roster.find((p) => p.id === pickedId)
		});

		// Not the very next card, and not left to the bottom of the pile either.
		expect(current(game).player.id).not.toBe(missed.player.id);
		const at = deckIds(game).indexOf(missed.player.id);
		// One card has been drawn off the top since it went back in.
		expect(at).toBeGreaterThanOrEqual(REINSERT_MIN - 1);
		expect(at).toBeLessThanOrEqual(REINSERT_MAX - 1);
		expect(game.deck).toHaveLength(11);
	});

	it('brings a missed card back after whatever is left when the pile is short', () => {
		const roster = players(2);
		const game = newGame(roster);
		const missed = current(game).player;
		const other = roster.find((p) => p.id !== missed.id)!;

		game.guess(other.id);
		expect(current(game).player.id).toBe(other.id);

		game.guess(other.id);
		expect(current(game).player.id).toBe(missed.id);

		game.guess(missed.id);
		expect(game.current).toBeNull();
		expect(game.guesses).toBe(3);
		expect(game.missed).toEqual([missed.id]);
		expect(game.firstTry).toBe(1);
		// In the order they were found: the one that took no wrong answer first.
		expect(game.outcomes).toEqual([true, false]);
		expect(ids(game.missedPlayers)).toEqual([missed.id]);
		expect(game.perfect).toBe(false);
	});

	it('counts a player as missed once, however many wrong answers their card takes', () => {
		const roster = players(2);
		const game = newGame(roster);
		const missed = current(game).player;
		const other = roster.find((p) => p.id !== missed.id)!;

		game.guess(other.id);
		game.guess(other.id);
		expect(current(game).player.id).toBe(missed.id);
		game.guess(other.id);
		// Nothing else is left, so it is straight back up.
		expect(current(game).player.id).toBe(missed.id);
		game.guess(missed.id);

		expect(game.current).toBeNull();
		expect(game.guesses).toBe(4);
		expect(game.missed).toEqual([missed.id]);
		expect(game.firstTry).toBe(1);
	});

	it('gives every card its own key, including one that comes round again', () => {
		const roster = players(2);
		const game = newGame(roster);
		const keys = new Set<number>();
		const missed = current(game).player;
		const other = roster.find((p) => p.id !== missed.id)!;

		keys.add(current(game).key);
		game.guess(other.id);
		keys.add(current(game).key);
		game.guess(other.id);
		// The missed player again, on a new card.
		expect(current(game).player.id).toBe(missed.id);
		keys.add(current(game).key);

		expect(keys.size).toBe(3);
	});

	it('remembers a mix-up, and offers each of the two when the other next comes up', () => {
		const game = newGame(players(20));
		const card = current(game);
		const picked = wrongAnswer(game);

		game.guess(picked);
		expect(game.confusions).toEqual([[card.player.id, picked]]);

		// The picked player's own card goes to the bottom of the pile, out of
		// the way. Turned over just before the missed card came back, it would
		// leave their number on show, and a player whose number is on show is
		// kept off the next card whoever they were mixed up with: see
		// 'still leaves a preferred player out while their number is on show'
		// in game.test.ts. That happens about one game in twenty.
		const theirs = (step: { player: Player }) => step.player.id === picked;
		game.deck = [...game.deck.filter((step) => !theirs(step)), ...game.deck.filter(theirs)];

		// Five names out of twenty: by chance alone the one picked would be on
		// the card one time in four. It is there because it was picked.
		advanceUntil(game, () => current(game).player.id === card.player.id);
		expect(current(game).optionIds).toContain(picked);
	});

	describe('with two players on one number', () => {
		const roster = () => [player(1, 9), player(2, 9), player(3), player(4)];

		/** Answer cards with their own player until one of the two is up. */
		function upToShared(game: GameState) {
			advanceUntil(game, () => current(game).player.sweaterNumber === 9);
			return current(game);
		}

		it('accepts either wearer, identifying only the one picked', () => {
			const game = newGame(roster(), 'hard');
			const card = upToShared(game);
			const other = card.player.id === 1 ? 2 : 1;
			const foundBefore = game.identified.length;

			game.guess(other);

			expect(game.resolved?.correct).toBe(true);
			// Whoever was picked is shown, not whoever the card was built from:
			// the answer was accepted, and the other name would read as a correction.
			expect(game.resolved?.player.id).toBe(other);
			expect(game.identified).toHaveLength(foundBefore + 1);
			expect(game.identified).toContain(other);
			expect(game.identified).not.toContain(card.player.id);
			// Not a miss, and the card's own player is still to be found.
			expect(game.missed).toEqual([]);
			expect([current(game).player.id, ...deckIds(game)]).toContain(card.player.id);
			expect(deckIds(game)).not.toContain(other);

			finish(game);
			expect(ascending(game.identified)).toEqual([1, 2, 3, 4]);
			expect(game.perfect).toBe(true);
		});

		it('finds the card’s own player when the wearer picked has already been found', () => {
			// Only a closed book still offers a player who has been found. Without
			// this the card would be right every time and never leave the pile.
			const game = newGame(roster(), 'hard');
			const first = upToShared(game).player.id;
			game.guess(first);
			const card = upToShared(game);
			expect(card.player.id).not.toBe(first);
			const guessesBefore = game.guesses;

			game.guess(first);

			expect(game.resolved?.correct).toBe(true);
			expect(game.identified).toContain(card.player.id);
			expect(new Set(game.identified).size).toBe(game.identified.length);
			expect(game.guesses).toBe(guessesBefore + 1);
			expect(game.missed).toEqual([]);

			finish(game);
			expect(ascending(game.identified)).toEqual([1, 2, 3, 4]);
		});

		it('still counts a different number as wrong', () => {
			const game = newGame(roster(), 'hard');
			const card = upToShared(game);

			game.guess(3);

			expect(game.resolved?.correct).toBe(false);
			expect(game.resolved?.player.id).toBe(card.player.id);
			expect(game.missed).toEqual([card.player.id]);
		});
	});
});

describe('a closed-book level', () => {
	it('offers as many names on the last card as on the first', () => {
		const game = newGame(players(8), 'easy');

		expect(game.closedBook).toBe(true);
		const counts: number[] = [];
		for (let turn = 0; game.current && turn < 100; turn++) {
			counts.push(game.current.optionIds.length);
			game.guess(game.current.player.id);
		}
		expect(counts).toEqual([5, 5, 5, 5, 5, 5, 5, 5]);
	});

	it('offers the whole roster on Hard, in the same order for every card', () => {
		const game = newGame([...players(6), player(7, null)], 'hard');

		for (let turn = 0; game.current && turn < 100; turn++) {
			expect(game.current.optionIds).toEqual([1, 2, 3, 4, 5, 6]);
			game.guess(game.current.player.id);
		}
		expect(game.remaining).toBe(0);
	});
});

describe('the score', () => {
	it.each<[LevelKey, string | null]>([
		['learn', null],
		['easy', 'bronze'],
		['medium', 'silver'],
		['hard', 'gold']
	])('a run at %s plays for %s', (level, medal) => {
		const game = newGame(players(4), level);

		expect(game.stake).toBe(medal);
		expect(game.perfect).toBe(true);
	});

	it('is perfect for a run with no misses, with every player found on the first try', () => {
		const game = newGame(players(5), 'medium');

		finish(game);

		expect(game.perfect).toBe(true);
		expect(game.firstTry).toBe(5);
		expect(game.outcomes).toEqual([true, true, true, true, true]);
		expect(game.missedPlayers).toEqual([]);
		expect(game.stake).toBe('silver');
	});

	it('stops being perfect at the first miss, and stays that way to the end', () => {
		const game = newGame(players(5), 'easy');

		game.guess(current(game).player.id);
		game.guess(wrongAnswer(game));
		expect(game.perfect).toBe(false);

		finish(game);
		expect(game.perfect).toBe(false);
		expect(game.firstTry).toBe(4);
		expect(game.outcomes.filter((firstTry) => !firstTry)).toHaveLength(1);
		// Still the medal that was being played for: the page shows it as lost.
		expect(game.stake).toBe('bronze');
	});

	it('does not count players without a number, who were never asked about', () => {
		const game = newGame([player(1), player(2), player(3, null)], 'easy');

		finish(game);

		expect(game.firstTry).toBe(2);
		expect(game.outcomes).toEqual([true, true]);
	});
});

describe('the end of the deck', () => {
	it('ends the game once everyone is identified, and ignores guesses after that', () => {
		const game = newGame(players(3));

		finish(game);

		expect(game.current).toBeNull();
		expect(game.activeOptions).toEqual([]);
		expect(ascending(game.identified)).toEqual([1, 2, 3]);
		expect(game.guesses).toBe(3);
		expect(game.deck).toEqual([]);
		expect(game.remaining).toBe(0);
		// The last card stays on the pile to be read.
		expect(game.resolved).not.toBeNull();

		game.guess(1);
		expect(game.guesses).toBe(3);
	});

	it('deals a fresh game on reset, without reusing a card key', () => {
		const game = newGame(players(3), 'easy');
		game.guess(wrongAnswer(game));
		finish(game);
		const lastKey = game.resolved!.key;

		game.reset();

		expect(game.identified).toEqual([]);
		expect(game.missed).toEqual([]);
		expect(game.confusions).toEqual([]);
		expect(game.guesses).toBe(0);
		expect(game.perfect).toBe(true);
		expect(game.resolved).toBeNull();
		expect(game.previous).toBeNull();
		expect(game.lastMove).toBeNull();
		expect(game.deck).toHaveLength(2);
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

	it.each<LevelKey>(['learn', 'easy'])(
		'has no card to deal at %s, before or after a reset, rather than failing to build one',
		(level) => {
			const game = newGame(roster, level);

			expect(game.current).toBeNull();
			expect(game.guessableCount).toBe(0);
			expect(game.identified).toEqual([1, 2]);

			game.guess(1);
			game.next();
			expect(game.guesses).toBe(0);

			game.reset();
			expect(game.current).toBeNull();
			expect(game.activeOptions).toEqual([]);
		}
	);
});

describe('Learn', () => {
	const learn = (count: number) => newGame(players(count), 'learn');

	it('deals the first players face up, a batch at a time, with nothing to answer', () => {
		const game = learn(12);
		const card = current(game);

		expect(game.phase).toBe('learn');
		expect(game.closedBook).toBe(false);
		expect(card.kind).toBe('intro');
		expect(card.optionIds).toEqual([]);
		expect(game.activeOptions).toEqual([]);
		// The rest of the first batch is in the pile; everyone else waits.
		expect(game.deck).toHaveLength(GROUP_SIZE - 1);
		expect(game.deck.every((step) => step.kind === 'intro')).toBe(true);
		expect(game.waiting).toHaveLength(12 - GROUP_SIZE);
		expect(game.introduced).toEqual([]);
		expect(game.remaining).toBe(12);

		// An introduction is not a question.
		game.guess(card.player.id);
		expect(game.guesses).toBe(0);
		expect(current(game).key).toBe(card.key);
	});

	it('asks about a player a couple of cards after introducing them', () => {
		const game = learn(12);
		const introduced = current(game).player.id;

		game.next();

		expect(game.introduced).toEqual([introduced]);
		expect(game.lastMove).toBe('next');
		expect(game.moves).toBe(1);
		expect(game.guesses).toBe(0);
		// Another introduction is up, and the first player's question is in the
		// pile: one card has been drawn off the top since it went in.
		expect(current(game).kind).toBe('intro');
		const at = game.deck.findIndex((step) => step.kind === 'quiz');
		expect(game.deck[at]?.player.id).toBe(introduced);
		expect(at).toBeGreaterThanOrEqual(QUIZ_AFTER_MIN - 1);
		expect(at).toBeLessThanOrEqual(QUIZ_AFTER_MAX - 1);
		expect(game.deck).toHaveLength(GROUP_SIZE - 1);
	});

	it('offers only players who have been introduced, and learns the one named', () => {
		const game = learn(12);
		advanceUntil(game, () => current(game).kind === 'quiz');
		const card = current(game);

		expect(game.introduced).toContain(card.player.id);
		expect(card.optionIds).toContain(card.player.id);
		expect(card.optionIds.length).toBeLessThanOrEqual(3);
		expect(card.optionIds.length).toBeGreaterThan(1);
		expect(card.optionIds.every((id) => game.introduced.includes(id))).toBe(true);

		game.guess(card.player.id);

		// Learned: the roster, an open book here, now shows their number.
		expect(game.identified).toEqual([card.player.id]);
		expect(game.remaining).toBe(11);
		expect(game.guesses).toBe(1);
	});

	it('goes on offering a player already learned, so earlier ones are told apart from later', () => {
		const game = learn(12);
		advanceUntil(game, () => game.identified.length === GROUP_SIZE);
		const learned = [...game.identified];

		// The second batch: its questions can only be filled out from the first.
		advanceUntil(
			game,
			() => current(game).kind === 'quiz' && !learned.includes(current(game).player.id)
		);
		const card = current(game);
		expect(card.optionIds).toHaveLength(3);
		expect(card.optionIds.every((id) => game.introduced.includes(id))).toBe(true);
	});

	it('does not score a miss while introducing, but brings the card back with the mix-up on it', () => {
		const game = learn(12);
		advanceUntil(game, () => current(game).kind === 'quiz');
		const card = current(game);
		const picked = wrongAnswer(game);

		game.guess(picked);

		expect(game.missed).toEqual([]);
		expect(game.perfect).toBe(true);
		expect(game.identified).toEqual([]);
		expect(game.resolved?.correct).toBe(false);
		expect(game.resolved?.picked?.id).toBe(picked);
		expect(game.confusions).toEqual([[card.player.id, picked]]);
		expect(
			game.deck.some((step) => step.kind === 'quiz' && step.player.id === card.player.id)
		).toBe(true);

		advanceUntil(
			game,
			() => current(game).kind === 'quiz' && current(game).player.id === card.player.id
		);
		expect(current(game).again).toBe(false);
		game.guess(card.player.id);
		expect(game.identified).toContain(card.player.id);
	});

	it('deals the next batch once the first is learned, with a few earlier players coming round again', () => {
		const game = learn(12);
		advanceUntil(game, () => game.identified.length === GROUP_SIZE);
		const learned = [...game.identified];

		// The guess that learned the last of the batch dealt the next one.
		const card = current(game);
		expect(card.kind).toBe('intro');
		expect(learned).not.toContain(card.player.id);
		expect(game.waiting).toHaveLength(12 - GROUP_SIZE * 2);
		const intros = game.deck.filter((step) => step.kind === 'intro');
		const reviews = game.deck.filter((step) => step.kind === 'quiz');
		expect(intros).toHaveLength(GROUP_SIZE - 1);
		expect(reviews).toHaveLength(REVIEWS_PER_GROUP);
		expect(reviews.every((step) => learned.includes(step.player.id))).toBe(true);

		// A review is a question like any other, and a right answer to it changes
		// nothing: the player was learned already.
		advanceUntil(
			game,
			() => current(game).kind === 'quiz' && learned.includes(current(game).player.id)
		);
		game.guess(current(game).player.id);
		expect(ascending(game.identified.filter((id) => learned.includes(id)))).toEqual(
			ascending(learned)
		);
		expect(new Set(game.identified).size).toBe(game.identified.length);
	});

	it('ends with a final lap: everyone once more, the book shut, and that is the score', () => {
		const game = learn(12);

		advanceUntil(game, () => game.phase === 'lap');

		// Everyone is to be found again, and this time the roster shows nothing.
		expect(game.closedBook).toBe(true);
		expect(game.identified).toEqual([]);
		expect(game.remaining).toBe(12);
		expect(game.outcomes).toEqual([]);
		expect(game.waiting).toEqual([]);
		expect(game.deck).toHaveLength(11);
		expect(game.deck.every((step) => step.kind === 'quiz')).toBe(true);
		const card = current(game);
		expect(card.kind).toBe('quiz');
		// Three names, as before, but now from the whole roster.
		expect(card.optionIds).toHaveLength(3);

		finish(game);

		expect(game.current).toBeNull();
		expect(game.phase).toBe('lap');
		expect(game.firstTry).toBe(12);
		expect(game.perfect).toBe(true);
		expect(game.outcomes).toHaveLength(12);
		expect(game.countsAs).toBe('learn');
		// Learn plays for no medal, however it goes.
		expect(game.stake).toBeNull();
	});

	it('scores a miss in the final lap, and asks twice more before the player counts', () => {
		const game = learn(8);
		advanceUntil(game, () => game.phase === 'lap');
		const missed = current(game).player.id;
		const up = () => current(game).player.id === missed;

		game.guess(wrongAnswer(game));
		expect(game.missed).toEqual([missed]);
		expect(game.perfect).toBe(false);
		const back = game.deck.find((step) => step.player.id === missed);
		expect(back?.again).toBe(true);

		// Soon: right this time, but it was only just corrected.
		advanceUntil(game, up);
		expect(current(game).again).toBe(true);
		game.guess(missed);
		expect(game.resolved?.correct).toBe(true);
		expect(game.identified).not.toContain(missed);
		// So it goes to the bottom of the pile, to be asked once more.
		expect(game.deck.at(-1)).toEqual({ kind: 'quiz', player: player(missed) });

		// Late: right again, and now it counts.
		advanceUntil(game, up);
		expect(current(game).again).toBe(false);
		game.guess(missed);
		expect(game.identified).toContain(missed);

		finish(game);
		expect(game.firstTry).toBe(7);
		expect(ids(game.missedPlayers)).toEqual([missed]);
		expect(game.outcomes.filter((firstTry) => !firstTry)).toHaveLength(1);
	});

	it('starts the two right answers over when the second of them is wrong', () => {
		const game = learn(6);
		advanceUntil(game, () => game.phase === 'lap');
		const missed = current(game).player.id;
		const up = () => current(game).player.id === missed;

		game.guess(wrongAnswer(game));
		advanceUntil(game, up);
		game.guess(missed);
		advanceUntil(game, up);
		// The late one, wrong.
		game.guess(wrongAnswer(game));

		expect(game.missed).toEqual([missed]);
		expect(game.identified).not.toContain(missed);
		advanceUntil(game, up);
		expect(current(game).again).toBe(true);

		finish(game);
		expect(game.current).toBeNull();
		expect(game.firstTry).toBe(5);
	});

	it("asks twice more all the same when the miss is next named on the card of the number's other wearer", () => {
		// Players 2 and 3 on one number.
		const pair = [2, 3];
		const game = newGame(
			players(8).map((p) => (p.id === 3 ? player(3, 2) : p)),
			'learn'
		);
		advanceUntil(game, () => game.phase === 'lap');
		const start = game.guesses;

		// Whichever of the two comes up first is missed, for someone on another number.
		advanceUntil(game, () => pair.includes(current(game).player.id));
		const missed = current(game).player.id;
		const other = pair.find((id) => id !== missed)!;
		game.guess(8);
		expect(game.missed).toEqual([missed]);

		// The other one's card comes up before the missed one's does again...
		if (current(game).player.id !== other) {
			const theirs = game.deck.find((step) => step.player.id === other)!;
			game.deck = [theirs, ...game.deck.filter((step) => step !== theirs)];
			advance(game);
		}
		expect(current(game).player.id).toBe(other);
		expect(game.deck.find((step) => step.player.id === missed)?.again).toBe(true);

		// ...and is answered with the player who was missed, which is right: it
		// is the number that is asked about.
		game.guess(missed);
		expect(game.resolved?.correct).toBe(true);

		// That is the missed player named rightly soon after the correction, and
		// no more than that. Their card is still to come, at the bottom of the
		// pile, and so is the one just answered.
		expect(game.identified).not.toContain(missed);
		expect(game.identified).not.toContain(other);
		// (The top of the pile is already up, and is one of the two when nothing
		// else is left in it.)
		const pile = [current(game), ...game.deck];
		expect(pile.map((step) => step.player.id).slice(-2)).toEqual([missed, other]);
		expect(pile.some((step) => step.again)).toBe(false);

		finish(game);
		expect(game.current).toBeNull();
		expect(ascending(game.identified)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
		expect(game.firstTry).toBe(7);
		// Everyone once, and two more for the miss, as for any other.
		expect(game.guesses - start).toBe(8 + 2);
	});

	it('plays through a roster smaller than a batch', () => {
		const game = learn(1);

		expect(current(game).kind).toBe('intro');
		game.next();
		// Asked about straight away, with nobody to be mistaken for.
		expect(current(game).kind).toBe('quiz');
		expect(current(game).optionIds).toEqual([1]);

		finish(game);
		expect(game.firstTry).toBe(1);
	});
});

describe('setLevel', () => {
	it('before the first guess, makes it a game at the new level on the same card', () => {
		const game = newGame(players(12), 'easy');
		const card = current(game);
		expect(card.optionIds).toHaveLength(5);

		game.setLevel('medium');

		expect(game.level).toBe('medium');
		expect(game.countsAs).toBe('medium');
		expect(current(game).key).toBe(card.key);
		expect(current(game).player.id).toBe(card.player.id);
		expect(current(game).optionIds).toHaveLength(10);
		expect(current(game).optionIds).toContain(card.player.id);

		// And on again, with nothing played in between to count against it.
		game.setLevel('hard');
		expect(game.countsAs).toBe('hard');
		expect(current(game).optionIds).toHaveLength(12);
	});

	it('between quiz levels mid-game, keeps the card and counts the run as the easier level', () => {
		const game = newGame(players(12), 'hard');
		game.guess(current(game).player.id);
		const card = current(game);

		game.setLevel('easy');

		expect(current(game).key).toBe(card.key);
		expect(current(game).optionIds).toHaveLength(5);
		expect(current(game).optionIds).toContain(card.player.id);
		expect(game.guesses).toBe(1);
		expect(game.countsAs).toBe('easy');
		expect(game.stake).toBe('bronze');

		// Turning it back up deals the harder card again, but the run has still
		// used the easier level.
		game.setLevel('hard');
		expect(current(game).optionIds).toHaveLength(12);
		expect(game.level).toBe('hard');
		expect(game.countsAs).toBe('easy');
		expect(game.stake).toBe('bronze');
	});

	it('going up a level mid-game does not raise what the run counts as', () => {
		const game = newGame(players(12), 'easy');
		game.guess(current(game).player.id);

		game.setLevel('medium');

		expect(current(game).optionIds).toHaveLength(10);
		expect(game.countsAs).toBe('easy');
	});

	it('from Learn to a quiz level, starts a quiz from the top', () => {
		const game = newGame(players(8), 'learn');
		advanceUntil(game, () => game.guesses === 2);

		game.setLevel('easy');

		expect(game.level).toBe('easy');
		expect(game.countsAs).toBe('easy');
		expect(game.phase).toBeNull();
		expect(game.guesses).toBe(0);
		expect(game.identified).toEqual([]);
		expect(game.introduced).toEqual([]);
		expect(game.waiting).toEqual([]);
		expect(game.resolved).toBeNull();
		expect(game.deck).toHaveLength(7);
		expect(current(game).kind).toBe('quiz');
	});

	it('from a quiz level to Learn, starts the introductions from the top', () => {
		const game = newGame(players(8), 'hard');
		game.guess(current(game).player.id);
		game.guess(wrongAnswer(game));

		game.setLevel('learn');

		expect(game.countsAs).toBe('learn');
		expect(game.phase).toBe('learn');
		expect(game.guesses).toBe(0);
		expect(game.identified).toEqual([]);
		expect(game.missed).toEqual([]);
		expect(current(game).kind).toBe('intro');
	});

	it('starts over to or from Learn even before the first guess: they are not the same game', () => {
		const game = newGame(players(8), 'learn');
		game.next();
		expect(game.introduced).toHaveLength(1);

		game.setLevel('hard');

		expect(game.introduced).toEqual([]);
		expect(current(game).kind).toBe('quiz');
		expect(current(game).optionIds).toHaveLength(8);
	});

	it('applies to the cards that follow', () => {
		const game = newGame(players(12), 'easy');

		game.setLevel('medium');
		game.guess(current(game).player.id);

		expect(current(game).optionIds).toHaveLength(10);
	});

	it('is remembered once the game is over, without changing what the finished run counts as', () => {
		const game = newGame(players(3), 'easy');
		finish(game);

		game.setLevel('hard');

		expect(game.level).toBe('hard');
		expect(game.countsAs).toBe('easy');
		expect(game.current).toBeNull();
		expect(game.guesses).toBe(3);

		// The next game is dealt at it.
		game.reset();
		expect(game.countsAs).toBe('hard');
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

	/** A quiz two guesses in — one right, one wrong — and saved. */
	function midGame(level: LevelKey = 'easy') {
		const { storage, items } = memoryStorage();
		const game = newGame(roster(), level);
		game.guess(current(game).player.id);
		game.guess(wrongAnswer(game));
		game.save(storage, TEAM);
		return { storage, items, game };
	}

	/** A game of Learn played, rightly, until something is true of it, and saved. */
	function learnGame(reached: (game: GameState) => boolean, players = roster()) {
		const { storage, items } = memoryStorage();
		const game = newGame(players, 'learn');
		advanceUntil(game, () => reached(game));
		game.save(storage, TEAM);
		return { storage, items, game };
	}

	/** A new visit to the page, with the level setting as it now stands. */
	function revisit(level: LevelKey = 'easy', players = roster()) {
		const game = new GameState(players);
		game.setLevel(level);
		return game;
	}

	/** What a restore has to bring back. Card keys are per instance, and the
	 *  guessed pile is deliberately not kept. */
	function snapshot(game: GameState) {
		return {
			level: game.level,
			countsAs: game.countsAs,
			phase: game.phase,
			identified: [...game.identified],
			missed: [...game.missed],
			guesses: game.guesses,
			deck: game.deck.map((step) => ({ ...step, player: step.player.id })),
			waiting: ids(game.waiting),
			introduced: [...game.introduced],
			confusions: game.confusions.map((pair) => [...pair]),
			current: game.current && {
				kind: game.current.kind,
				again: game.current.again,
				player: game.current.player.id,
				optionIds: [...game.current.optionIds]
			}
		};
	}

	type StoredStep = { k: 'i' | 'q'; id: number; a?: true };
	type Stored = {
		identified: number[];
		missed: number[];
		introduced: number[];
		waiting: number[];
		deck: StoredStep[];
		current: StoredStep & { options: number[] };
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

	it.each<LevelKey>(['easy', 'hard'])('comes back as it was left, mid-game at %s', (level) => {
		const { storage, game } = midGame(level);

		const restored = revisit(level);
		expect(restored.restore(storage, TEAM)).toBe(true);

		expect(restored.dealt).toBe(true);
		expect(snapshot(restored)).toEqual(snapshot(game));
		expect(restored.missed).toHaveLength(1);
		expect(restored.perfect).toBe(false);
	});

	it('does not bring back the last guess, which would be announced as though just made', () => {
		const { storage, game } = midGame();
		expect(game.resolved).not.toBeNull();

		const restored = revisit();
		restored.restore(storage, TEAM);

		expect(restored.resolved).toBeNull();
		expect(restored.previous).toBeNull();
		expect(restored.lastMove).toBeNull();
	});

	it('comes back finished when it was finished', () => {
		const { storage, game } = midGame('easy');
		finish(game);
		game.save(storage, TEAM);

		const restored = revisit('easy');
		expect(restored.restore(storage, TEAM)).toBe(true);

		expect(restored.current).toBeNull();
		expect(restored.deck).toEqual([]);
		expect(restored.guesses).toBe(game.guesses);
		expect(ascending(restored.identified)).toEqual([1, 2, 3, 4, 5, 6]);
		// With its score.
		expect(restored.firstTry).toBe(4);
		expect(restored.countsAs).toBe('easy');
	});

	it('is kept per team', () => {
		const { storage } = midGame();

		expect(revisit().restore(storage, 'nhl:OTH')).toBe(false);
	});

	it('holds nothing until a guess is made, and nothing again after Play Again', () => {
		const { storage, items } = memoryStorage();
		const game = newGame(roster());

		game.save(storage, TEAM);
		expect(items.has(KEY)).toBe(false);

		game.guess(current(game).player.id);
		game.save(storage, TEAM);
		expect(items.has(KEY)).toBe(true);

		game.reset();
		game.save(storage, TEAM);
		expect(items.has(KEY)).toBe(false);
	});

	it('is not written before the first deal', () => {
		const { storage, items } = memoryStorage({ [KEY]: 'left by an earlier game' });

		new GameState(roster()).save(storage, TEAM);

		expect(items.get(KEY)).toBe('left by an earlier game');
	});

	describe('of Learn', () => {
		it('is kept from the first introduction looked at', () => {
			const { storage, items } = memoryStorage();
			const game = newGame(roster(), 'learn');

			game.save(storage, TEAM);
			expect(items.has(KEY)).toBe(false);

			game.next();
			game.save(storage, TEAM);
			expect(items.has(KEY)).toBe(true);
		});

		it.each<[string, (game: GameState) => boolean]>([
			['on an introduction', (game) => game.introduced.length === 2],
			['on a question', (game) => game.guesses === 1 && current(game).kind === 'quiz'],
			['on a second batch', (game) => game.identified.length === GROUP_SIZE + 2],
			['in the final lap', (game) => game.phase === 'lap' && game.identified.length === 2]
		])('comes back as it was left, %s', (_name, reached) => {
			const { storage, game } = learnGame(reached, players(8));

			const restored = revisit('learn', players(8));
			expect(restored.restore(storage, TEAM)).toBe(true);

			expect(snapshot(restored)).toEqual(snapshot(game));
		});

		it('comes back with its mix-ups, and with a card that is to be asked twice', () => {
			const { storage, game } = learnGame((game) => game.phase === 'lap', players(8));
			const missed = current(game).player.id;
			game.guess(wrongAnswer(game));
			advanceUntil(game, () => current(game).player.id === missed);
			game.save(storage, TEAM);

			const restored = revisit('learn', players(8));
			expect(restored.restore(storage, TEAM)).toBe(true);

			expect(current(restored).again).toBe(true);
			expect(restored.confusions).toEqual(game.confusions);
			expect(restored.missed).toEqual([missed]);
			expect(snapshot(restored)).toEqual(snapshot(game));
		});

		it.each<[string, Change]>([
			[
				'a question about someone never introduced',
				({ deck, waiting }) => ({
					deck: [...deck, { k: 'q', id: waiting[0] }]
				})
			],
			['a player in no place at all', ({ waiting }) => ({ waiting: waiting.slice(1) })],
			[
				'a player in two places',
				({ waiting, introduced }) => ({
					waiting: [...waiting, introduced[0]]
				})
			],
			['a miss scored before the final lap', ({ introduced }) => ({ missed: [introduced[0]] })],
			[
				'someone learned without being introduced',
				({ identified, waiting }) => ({
					identified: [...identified, waiting[0]]
				})
			],
			[
				'someone introduced who will never be asked about',
				({ deck }) => ({
					deck: deck.filter((step) => step.k !== 'q')
				})
			],
			['no phase', { phase: null }],
			['a phase there is no such thing as', { phase: 'review' }]
		])('is dropped when it has %s', (_name, change) => {
			// Two introduced, neither yet asked about; three still waiting.
			const { storage, items } = learnGame(
				(game) => game.introduced.length === 2 && current(game).kind === 'intro',
				players(8)
			);
			items.set(KEY, tampered(items, change));

			const game = revisit('learn', players(8));
			expect(game.restore(storage, TEAM)).toBe(false);
			expect(game.dealt).toBe(false);
			expect(items.has(KEY)).toBe(false);
		});
	});

	describe('when the level has been changed since it was saved', () => {
		it('re-deals the answers, and counts the run as the easier of the two quiz levels', () => {
			const { storage, game } = midGame('hard');

			const restored = revisit('easy');
			expect(restored.restore(storage, TEAM)).toBe(true);

			expect(current(restored).player.id).toBe(current(game).player.id);
			// Five numbered players, so Easy offers them all here, as Hard did;
			// what changes is what the run is worth.
			expect(current(restored).optionIds).toContain(current(game).player.id);
			expect(restored.level).toBe('easy');
			expect(restored.countsAs).toBe('easy');
			expect(restored.guesses).toBe(2);
		});

		it('does not raise what the run counts as when the level has gone up', () => {
			const { storage } = midGame('easy');

			const restored = revisit('hard');
			expect(restored.restore(storage, TEAM)).toBe(true);

			expect(restored.level).toBe('hard');
			expect(restored.countsAs).toBe('easy');
		});

		it('is dropped mid-quiz when the level is now Learn, as the change would have restarted it', () => {
			const { storage, items } = midGame('medium');

			const restored = revisit('learn');
			expect(restored.restore(storage, TEAM)).toBe(false);

			expect(restored.dealt).toBe(false);
			expect(items.has(KEY)).toBe(false);
		});

		it('is dropped mid-Learn when the level is now a quiz', () => {
			const { storage, items } = learnGame((game) => game.guesses === 1);

			const restored = revisit('easy');
			expect(restored.restore(storage, TEAM)).toBe(false);

			expect(restored.dealt).toBe(false);
			expect(items.has(KEY)).toBe(false);
		});

		it('still comes back when it was finished, as the level it was played at', () => {
			const { storage } = learnGame((game) => game.current === null);

			const restored = revisit('hard');
			expect(restored.restore(storage, TEAM)).toBe(true);

			expect(restored.current).toBeNull();
			expect(restored.countsAs).toBe('learn');
			expect(restored.stake).toBeNull();
			expect(restored.firstTry).toBe(5);
		});
	});

	it.each([
		['text that is not JSON', '{"v":3,"identified":['],
		['JSON that is not a game', '"numbrrs"'],
		['null', 'null'],
		['an empty object', '{}']
	])('is dropped when storage holds %s', (_name, value) => {
		const { storage, items } = memoryStorage({ [KEY]: value });

		const game = revisit();
		expect(game.restore(storage, TEAM)).toBe(false);

		expect(game.dealt).toBe(false);
		expect(items.has(KEY)).toBe(false);
	});

	it.each<[string, Change]>([
		['another version', { v: 2 }],
		['no version', { v: undefined }],
		['a level that is not one', { level: 'expert' }],
		['no record of what the run counts as', { countsAs: undefined }],
		['a run counted as harder than the level in play', { countsAs: 'hard' }],
		['a phase, which only Learn has', { phase: 'lap' }],
		['a guess count that is not a count', { guesses: '2' }],
		['a negative guess count', { guesses: -1 }],
		['fewer guesses than it took to find and miss that many', { guesses: 1 }],
		['a pile that is not a list', { deck: 'all of them' }],
		['cards that are not cards', { deck: [3, 4, 5] }],
		['a player missing from every pile', { deck: [] }],
		['a player in two places', { identified: [1, 2, 3, 4, 5, 6] }],
		['two cards for one player', ({ deck }) => ({ deck: [...deck, deck[0]] })],
		[
			'a player who is not on the roster',
			({ deck }) => ({
				deck: [...deck.slice(1), { k: 'q', id: 99 }]
			})
		],
		[
			'a numberless player in the deck',
			({ identified, deck }) => ({
				identified: identified.filter((id) => id !== 6),
				deck: [...deck, { k: 'q', id: 6 }]
			})
		],
		[
			'an introduction, which only Learn deals',
			({ deck }) => ({
				deck: [{ k: 'i', id: deck[0]!.id }, ...deck.slice(1)]
			})
		],
		[
			'a card to be asked twice, which only the final lap has',
			({ deck }) => ({
				deck: [{ ...deck[0], a: true }, ...deck.slice(1)]
			})
		],
		[
			'players waiting for a batch, which only Learn has',
			({ deck }) => ({
				waiting: [deck[0]!.id],
				deck: deck.slice(1)
			})
		],
		[
			'no card up while cards remain',
			({ deck, current }) => ({
				deck: [{ k: 'q', id: current.id }, ...deck],
				current: null
			})
		],
		['a card that is not a card', { current: 3 }],
		[
			'a card without its own player among the answers',
			{
				current: { k: 'q', id: 1, options: [] }
			}
		],
		['misses that are not a list', { missed: 'a few' }],
		['a miss by a player who is not on the roster', { missed: [99] }],
		['a miss by a player who has no number', { missed: [6] }],
		['the same miss twice', ({ missed }) => ({ missed: [...missed, ...missed] })]
	])('is dropped when it has %s', (_name, change) => {
		const { storage, items } = midGame();
		items.set(KEY, tampered(items, change));

		const game = revisit();
		expect(game.restore(storage, TEAM)).toBe(false);

		expect(game.dealt).toBe(false);
		expect(game.guesses).toBe(0);
		expect(game.identified).toEqual([6]);
		expect(items.has(KEY)).toBe(false);
	});

	it('is dropped when Learn and a quiz level are mixed in one run', () => {
		const { storage, items } = midGame('easy');
		items.set(KEY, tampered(items, { countsAs: 'learn' }));

		expect(revisit('easy').restore(storage, TEAM)).toBe(false);
		expect(items.has(KEY)).toBe(false);
	});

	it('is kept when an answer on the card is someone already identified, as any card may have', () => {
		const { storage, game } = midGame('easy');
		const found = game.identified.find((id) => id !== 6)!;

		expect(current(game).optionIds).toContain(found);
		expect(revisit('easy').restore(storage, TEAM)).toBe(true);
	});

	it('is dropped when an answer on the card is a player with no number', () => {
		const { storage, items, game } = midGame('easy');
		const card = current(game);
		items.set(
			KEY,
			tampered(items, { current: { k: 'q', id: card.player.id, options: [card.player.id, 6] } })
		);

		expect(revisit('easy').restore(storage, TEAM)).toBe(false);
		expect(items.has(KEY)).toBe(false);
	});

	it('deals the answers again when the card has the wrong number of them', () => {
		const { storage, items, game } = midGame('easy');
		const card = current(game);
		const other = card.optionIds.find((id) => id !== card.player.id)!;
		items.set(
			KEY,
			tampered(items, { current: { k: 'q', id: card.player.id, options: [card.player.id, other] } })
		);

		const restored = revisit('easy');
		expect(restored.restore(storage, TEAM)).toBe(true);

		expect(current(restored).player.id).toBe(card.player.id);
		expect(current(restored).optionIds).toHaveLength(5);
	});

	it('leaves out a mix-up that makes no sense rather than dropping the game', () => {
		const { storage, items, game } = midGame('easy');
		const [real] = game.confusions;
		items.set(KEY, tampered(items, { confusions: [real, [1, 99], 'both of them', [6, 1]] }));

		const restored = revisit('easy');
		expect(restored.restore(storage, TEAM)).toBe(true);
		expect(restored.confusions).toEqual([real]);
	});

	it.each<[string, () => Player[]]>([
		['a player has left', () => roster().slice(1)],
		['a player has arrived', () => [...roster(), player(7)]],
		['a player has changed number', () => roster().map((p) => (p.id === 2 ? player(2, 22) : p))],
		['a numberless player has been given one', () => [...roster().slice(0, 5), player(6, 66)]]
	])('is dropped when %s since it was saved', (_name, changed) => {
		const { storage, items } = midGame();

		const game = revisit('easy', changed());
		expect(game.restore(storage, TEAM)).toBe(false);

		expect(game.dealt).toBe(false);
		expect(items.has(KEY)).toBe(false);
	});

	it('survives a roster that only changed order', () => {
		const { storage } = midGame();

		expect(revisit('easy', roster().reverse()).restore(storage, TEAM)).toBe(true);
	});

	it('costs nothing but the saved game when storage throws', () => {
		const blocked = () => {
			throw new DOMException('The operation is insecure.', 'SecurityError');
		};
		const storage: GameStorage = { getItem: blocked, setItem: blocked, removeItem: blocked };

		const game = revisit();
		expect(game.restore(storage, TEAM)).toBe(false);
		game.reset();
		game.save(storage, TEAM);
		game.guess(current(game).player.id);
		expect(() => game.save(storage, TEAM)).not.toThrow();

		expect(game.guesses).toBe(1);
		expect(game.current).not.toBeNull();
	});

	it('is skipped quietly when there is no storage at all', () => {
		const game = revisit();

		expect(game.restore(null, TEAM)).toBe(false);
		game.reset();
		game.guess(current(game).player.id);
		expect(() => game.save(null, TEAM)).not.toThrow();
	});
});

describe('a round of Learn about part of the roster', () => {
	const TEAM = 'nhl:TST';

	/** Eight players, of whom 7 and 8 are new to someone who knows the rest. */
	function focused(focus: number[] = [7, 8]) {
		const game = new GameState(players(8));
		game.setLevel('learn');
		game.reset(focus);
		return game;
	}

	function memoryStorage() {
		const items = new Map<string, string>();
		const storage: GameStorage = {
			getItem: (key) => items.get(key) ?? null,
			setItem: (key, value) => void items.set(key, value),
			removeItem: (key) => void items.delete(key)
		};
		return { storage, items };
	}

	it('deals only the players it is about, and counts everyone else as known', () => {
		const game = focused();

		expect(game.focus).toEqual([7, 8]);
		expect(game.phase).toBe('learn');
		expect(game.guessableCount).toBe(2);
		expect(game.remaining).toBe(2);
		expect(game.outcomes).toEqual([]);
		// Known already: shown with their numbers, and there to be offered.
		expect(ascending(game.identified)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(ascending(game.introduced)).toEqual([1, 2, 3, 4, 5, 6]);
		// One of the two is up, face up; the other is the rest of the batch.
		expect(current(game).kind).toBe('intro');
		expect([7, 8]).toContain(current(game).player.id);
		const intros = game.deck.filter((step) => step.kind === 'intro');
		expect(intros).toHaveLength(1);
		expect([7, 8]).toContain(intros[0]?.player.id);
		// And as with any batch, a couple of players already known come round
		// with it, to be told apart from the new ones.
		const reviews = game.deck.filter((step) => step.kind === 'quiz');
		expect(reviews).toHaveLength(REVIEWS_PER_GROUP);
		expect(reviews.every((step) => step.player.id <= 6)).toBe(true);
		expect(game.waiting).toEqual([]);
	});

	it('asks about a new player among the ones already known', () => {
		const game = focused();
		advanceUntil(
			game,
			() => current(game).kind === 'quiz' && [7, 8].includes(current(game).player.id)
		);
		const card = current(game);

		// Three names from the first question on: the rest of the roster is
		// there to choose from.
		expect(card.optionIds).toHaveLength(3);
		expect(card.optionIds).toContain(card.player.id);
	});

	it('ends on a lap of just those players, scored out of how many there were', () => {
		const game = focused();

		advanceUntil(game, () => game.phase === 'lap');
		expect(game.closedBook).toBe(true);
		expect(game.remaining).toBe(2);
		expect(ascending(game.identified)).toEqual([1, 2, 3, 4, 5, 6]);
		expect(game.deck).toHaveLength(1);
		expect([7, 8]).toContain(current(game).player.id);
		expect(current(game).optionIds).toHaveLength(3);

		game.guess(wrongAnswer(game));
		finish(game);

		expect(game.current).toBeNull();
		expect(game.firstTry).toBe(1);
		expect(game.outcomes).toHaveLength(2);
		expect(game.missedPlayers).toHaveLength(1);
		expect(ascending(game.identified)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
	});

	it('is a round of Learn only: a quiz level is always about the whole roster', () => {
		const game = new GameState(players(8));
		game.setLevel('easy');
		game.reset([7, 8]);

		expect(game.focus).toBeNull();
		expect(game.guessableCount).toBe(8);
		expect(game.identified).toEqual([]);
	});

	it.each<[string, number[]]>([
		['nobody on the roster', [99]],
		['nobody at all', []],
		['everybody', [1, 2, 3, 4, 5, 6, 7, 8]]
	])('is an ordinary game of Learn when it is asked to be about %s', (_name, focus) => {
		const game = focused(focus);

		expect(game.focus).toBeNull();
		expect(game.guessableCount).toBe(8);
		expect(game.introduced).toEqual([]);
		expect(game.identified).toEqual([]);
	});

	it('gives way to the whole roster on Play Again, and on a change of level', () => {
		const game = focused();
		game.reset();
		expect(game.focus).toBeNull();
		expect(game.guessableCount).toBe(8);

		const other = focused();
		other.next();
		other.setLevel('easy');
		expect(other.focus).toBeNull();
		expect(other.guessableCount).toBe(8);
		expect(other.identified).toEqual([]);
	});

	it.each<[string, (game: GameState) => boolean]>([
		['while introducing', (game) => game.introduced.length === 7],
		['in its lap', (game) => game.phase === 'lap']
	])('is kept for the tab %s, and comes back about the same players', (_name, reached) => {
		const { storage } = memoryStorage();
		const game = focused();
		advanceUntil(game, () => reached(game));
		game.save(storage, TEAM);

		const restored = new GameState(players(8));
		expect(restored.restore(storage, TEAM)).toBe(true);

		expect(restored.focus).toEqual([7, 8]);
		expect(restored.guessableCount).toBe(2);
		expect(restored.phase).toBe(game.phase);
		expect(restored.identified).toEqual(game.identified);
		expect(restored.introduced).toEqual(game.introduced);
		expect(current(restored).player.id).toBe(current(game).player.id);

		finish(restored);
		expect(restored.firstTry).toBe(2);
	});

	it.each<[string, (stored: Record<string, unknown>) => Record<string, unknown>]>([
		['about nobody', () => ({ focus: [] })],
		['about someone who is not on the roster', () => ({ focus: [7, 99] })],
		['about the same player twice', () => ({ focus: [7, 7, 8] })],
		[
			'with a player it is not about still to be found',
			(stored) => ({
				identified: (stored.identified as number[]).filter((id) => id !== 3)
			})
		],
		[
			'with a player it is not about not yet introduced',
			(stored) => ({
				introduced: (stored.introduced as number[]).filter((id) => id !== 3),
				waiting: [3]
			})
		],
		['with no word on who it is about', () => ({ focus: undefined })]
	])('is dropped when it is saved %s', (_name, change) => {
		const { storage, items } = memoryStorage();
		const game = focused();
		game.next();
		game.save(storage, TEAM);
		const key = saveKey(TEAM);
		const stored = JSON.parse(items.get(key)!) as Record<string, unknown>;
		items.set(key, JSON.stringify({ ...stored, ...change(stored) }));

		const restored = new GameState(players(8));
		expect(restored.restore(storage, TEAM)).toBe(false);
		expect(items.has(key)).toBe(false);
	});

	it('is dropped when a quiz level is saved as being about part of the roster', () => {
		const { storage, items } = memoryStorage();
		const game = newGame(players(8), 'easy');
		game.guess(current(game).player.id);
		game.save(storage, TEAM);
		const key = saveKey(TEAM);
		const stored = JSON.parse(items.get(key)!) as Record<string, unknown>;
		items.set(key, JSON.stringify({ ...stored, focus: [7, 8] }));

		const restored = new GameState(players(8));
		restored.setLevel('easy');
		expect(restored.restore(storage, TEAM)).toBe(false);
	});
});
