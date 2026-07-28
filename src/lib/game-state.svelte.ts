import { browser } from '$app/environment';
import { buildDeck, cardOptions, drawCard, preIdentifiedIds } from '$lib/game';
import type { Player } from '$lib/types';

const DIFFICULTY_KEY = 'numbrrs_difficulty';
export const DIFFICULTY_OPTIONS = [
	{ key: 'easy', value: 2 },
	{ key: 'medium', value: 4 },
	{ key: 'hard', value: 8 },
	{ key: 'expert', value: Infinity }
] as const;

const DEFAULT_DIFFICULTY = 2;

// The quiz is a physical deck. A card is drawn from the pile and shows its
// number; a guess flips it and sends it to the guessed pile, where it stays
// readable while the next card is already up — so there is no reveal phase
// that blocks play, and no auto-advance timer.
export type ActiveCard = { key: number; player: Player; optionIds: number[] };
export type ResolvedCard = { key: number; player: Player; correct: boolean };

// Reading and writing are both wrapped because localStorage throws rather
// than degrading when storage is unavailable — Safari private browsing, site
// data blocked, iOS under storage pressure. The write happens inside an
// $effect during initialisation, so an unguarded throw wouldn't just lose the
// setting, it would take the whole game down with it. Someone who can't
// persist a preference should still be able to play.
//
// Anything unexpected in storage (an old format, a hand-edited value) falls
// back to easy — Number(junk) is NaN, and NaN options would break the quiz.
function savedDifficulty(): number {
	if (!browser) return DEFAULT_DIFFICULTY;
	try {
		const stored = Number(localStorage.getItem(DIFFICULTY_KEY));
		return DIFFICULTY_OPTIONS.some((o) => o.value === stored) ? stored : DEFAULT_DIFFICULTY;
	} catch {
		return DEFAULT_DIFFICULTY;
	}
}

/**
 * The quiz's state and the moves that change it: dealing, guessing, and
 * switching difficulty mid-game. `roster` is fixed for the life of an
 * instance — the page remounts this whenever the roster it's for changes
 * (see RosterGame.svelte), so nothing here needs to react to it changing.
 */
export class GameState {
	#roster: Player[];
	// Cards are keyed by draw, not by player: a recycled player gets a fresh
	// card element, so no card on screen ever mutates its face. The counter
	// never resets (not even on Play Again) so a key can't collide with a
	// still-transitioning element from the previous game.
	#nextKey = 0;

	difficulty = $state(savedDifficulty());

	/** Face-down draw pile; the top card gets dealt into `current`. */
	deck = $state<Player[]>([]);
	/** Players whose card resolved without them being identified; reshuffled
	 *  into a fresh deck when the draw pile runs out. */
	recycle = $state<Player[]>([]);
	identified = $state<number[]>([]);
	guesses = $state(0);
	/** The drawn card being guessed at; null once both piles run dry (game over). */
	current = $state<ActiveCard | null>(null);
	/** The most recent guess, face-up on top of the guessed pile. */
	resolved = $state<ResolvedCard | null>(null);
	/** The card underneath it — visible while the newest one flies in, and
	 *  peeking out at an angle after it lands. */
	previous = $state<ResolvedCard | null>(null);

	/** Players who can be asked about — everyone else starts pre-identified. */
	readonly guessableCount: number;
	readonly rosterLength: number;

	constructor(roster: Player[]) {
		this.#roster = roster;
		this.guessableCount = roster.length - preIdentifiedIds(roster).length;
		this.rosterLength = roster.length;

		$effect(() => {
			try {
				localStorage.setItem(DIFFICULTY_KEY, String(this.difficulty));
			} catch {
				// Nothing else reads this, so the setting simply stays in memory for
				// the session rather than surviving a reload.
			}
		});

		this.reset();
	}

	// In the shuffled order the card chose — deriving this by filtering the
	// roster would quietly re-impose roster order instead.
	get activeOptions(): Player[] {
		return this.current
			? this.current.optionIds.flatMap((id) => this.#roster.find((p) => p.id === id) ?? [])
			: [];
	}

	/** Deal the top card, with its answer options at the current difficulty.
	 *  `avoidId`, when given, is left out of the options where possible — see
	 *  cardOptions. */
	#dealt(
		drawn: ReturnType<typeof drawCard<Player>>,
		identified: number[],
		avoidId?: number
	): ActiveCard | null {
		return (
			drawn && {
				key: this.#nextKey++,
				player: drawn.player,
				optionIds: cardOptions(
					this.#roster,
					identified,
					drawn.player,
					this.difficulty,
					undefined,
					avoidId
				)
			}
		);
	}

	/**
	 * A fresh game: nothing guessed yet beyond the numberless players. A roster
	 * where nobody has a number deals no cards, so it starts (and stays) on the
	 * summary instead of crashing on a question that can't be built.
	 */
	reset() {
		const identified = preIdentifiedIds(this.#roster);
		const drawn = drawCard(buildDeck(this.#roster), []);
		this.deck = drawn?.deck ?? [];
		this.recycle = [];
		this.identified = identified;
		this.guesses = 0;
		this.current = this.#dealt(drawn, identified);
		this.resolved = null;
		this.previous = null;
	}

	guess(playerId: number) {
		const card = this.current;
		if (!card) return;
		const guessed = this.#roster.find((p) => p.id === playerId);
		const answer = card.player.sweaterNumber;
		// Teams regularly carry two players on one number over a season — someone
		// departs and their replacement takes the sweater. The card only shows a
		// number, so every player wearing it is a right answer; picking the one the
		// card wasn't built from isn't a mistake. Only the player actually picked
		// is identified though, so the other still has to be found later.
		const correct = guessed != null && answer != null && guessed.sweaterNumber === answer;
		const identified = correct ? [...this.identified, guessed.id] : this.identified;
		// The guessed player's own card is done wherever it sits, deck or recycle
		// pile — their number has been learned.
		const deck = correct ? this.deck.filter((p) => p.id !== guessed.id) : this.deck;
		const recycle = correct ? this.recycle.filter((p) => p.id !== guessed.id) : this.recycle;
		// The resolved card is discarded only if its own player is now identified;
		// otherwise it returns to the pool — after a wrong guess, or a right guess
		// that identified the number's other wearer.
		const pool = identified.includes(card.player.id) ? recycle : [...recycle, card.player];
		const drawn = drawCard(deck, pool);
		const previous = this.resolved;
		// Reveal whoever was picked when the guess was right, not whichever
		// player the card happened to be built from — showing the other one
		// reads as a correction when the answer was accepted. Computed before
		// dealing the next card so its options can try to leave this player out.
		const justRevealed = correct ? guessed : card.player;

		this.deck = drawn?.deck ?? [];
		this.recycle = drawn?.recycle ?? [];
		this.identified = identified;
		this.guesses += 1;
		this.current = this.#dealt(drawn, identified, justRevealed.id);
		this.resolved = { key: card.key, player: justRevealed, correct };
		this.previous = previous;
	}

	/**
	 * Same card, refreshed options: the drawn number stays the question, only
	 * how many candidates surround it changes.
	 */
	setDifficulty(value: number) {
		this.difficulty = value;
		if (!this.current) return;
		this.current = {
			...this.current,
			optionIds: cardOptions(
				this.#roster,
				this.identified,
				this.current.player,
				value,
				undefined,
				this.resolved?.player.id
			)
		};
	}
}
