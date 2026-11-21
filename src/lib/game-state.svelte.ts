import { browser } from '$app/env';
import { buildDeck, cardOptions, drawCard, preIdentifiedIds } from '#lib/game.ts';
import type { Player } from '#lib/types.ts';

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
// data blocked, iOS under storage pressure. The first write happens while the
// game is being constructed, so an unguarded throw wouldn't just lose the
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

function saveDifficulty(value: number): void {
	if (!browser) return;
	try {
		localStorage.setItem(DIFFICULTY_KEY, String(value));
	} catch {
		// Nothing else reads this, so the setting simply stays in memory for
		// the session rather than surviving a reload.
	}
}

/** The part of the Web Storage API a saved game needs. `sessionStorage` in the
 *  browser; anything with these three methods in a test. */
export type GameStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * Where a game in progress is kept: the tab's session storage, so a refresh,
 * back/forward or the language toggle (a full page load) picks the game back
 * up, and closing the tab forgets it. Null on the server and wherever storage
 * is blocked — even reading the `sessionStorage` property throws there — and
 * the game then simply isn't kept.
 */
export function sessionGameStorage(): GameStorage | null {
	if (!browser) return null;
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

const SAVE_KEY_PREFIX = 'numbrrs_game:';
// Bumped whenever the saved shape changes: a game written by an older build is
// dropped rather than read as something it isn't.
const SAVE_VERSION = 1;

/**
 * One entry per team. The id carries no locale, so /game/… and /fr/game/… share
 * a saved game — switching language keeps it.
 */
export function saveKey(teamId: string): string {
	return SAVE_KEY_PREFIX + teamId;
}

/** A game as it is written to storage: player ids only, in pile order. The
 *  guessed pile is left out on purpose — see `restore`. */
type SavedGame = {
	v: typeof SAVE_VERSION;
	roster: string;
	identified: number[];
	guesses: number;
	deck: number[];
	recycle: number[];
	current: { id: number; options: number[] } | null;
};

/**
 * Who is on the roster and what they wear, as one comparable string. A saved
 * game only makes sense against the roster it was dealt from: after a trade or
 * a number change its piles would hold a player who has left, or miss one who
 * has arrived.
 */
function rosterSignature(roster: readonly Player[]): string {
	return roster
		.map((p) => `${p.id}:${p.sweaterNumber ?? ''}`)
		.sort()
		.join(',');
}

function isIdList(value: unknown): value is number[] {
	return Array.isArray(value) && value.every((id) => Number.isSafeInteger(id));
}

/**
 * Storage is outside the app's control — an older build, another tab, a
 * hand-edited value, a roster that has since changed — so nothing read from it
 * is trusted. Returns the saved game only if it is one this roster could
 * actually have reached; a game restored from anything less could deal a card
 * for a player who isn't there, or never end.
 */
function parseSavedGame(raw: string, roster: readonly Player[]): SavedGame | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof data !== 'object' || data === null) return null;
	const {
		v,
		roster: signature,
		identified,
		guesses,
		deck,
		recycle,
		current
	} = data as Record<string, unknown>;

	const expected = rosterSignature(roster);
	if (v !== SAVE_VERSION || signature !== expected) return null;
	if (!isIdList(identified) || !isIdList(deck) || !isIdList(recycle)) return null;
	if (typeof guesses !== 'number' || !Number.isSafeInteger(guesses) || guesses < 0) return null;

	let card: SavedGame['current'] = null;
	if (current !== null) {
		if (typeof current !== 'object') return null;
		const { id, options } = current as Record<string, unknown>;
		if (typeof id !== 'number' || !Number.isSafeInteger(id) || !isIdList(options)) return null;
		card = { id, options };
	}

	// Every player sits in exactly one place: identified, one of the two piles,
	// or on the card that's up.
	const placed = [...identified, ...deck, ...recycle, ...(card ? [card.id] : [])];
	const rosterIds = new Set(roster.map((p) => p.id));
	if (placed.length !== roster.length || new Set(placed).size !== placed.length) return null;
	if (!placed.every((id) => rosterIds.has(id))) return null;

	// Numberless players are never dealt, and each right guess identifies exactly
	// one player — so there can't be more players found than guesses made.
	const preIdentified = preIdentifiedIds(roster);
	if (!preIdentified.every((id) => identified.includes(id))) return null;
	if (guesses < identified.length - preIdentified.length) return null;

	if (card) {
		// The card's own player has to be among its answers, and nobody already
		// identified can be offered as one.
		if (!card.options.includes(card.id) || new Set(card.options).size !== card.options.length) {
			return null;
		}
		if (!card.options.every((id) => rosterIds.has(id) && !identified.includes(id))) return null;
	} else if (deck.length > 0 || recycle.length > 0) {
		// No card up with cards still to draw is not a state the game passes through.
		return null;
	}

	return { v: SAVE_VERSION, roster: expected, identified, guesses, deck, recycle, current: card };
}

/**
 * The quiz's state and the moves that change it: dealing, guessing, and
 * switching difficulty mid-game. `roster` is fixed for the life of an
 * instance — the page remounts this whenever the roster it's for changes
 * (see RosterGame.svelte), so nothing here needs to react to it changing.
 *
 * A new instance has dealt nothing. The page is rendered on the server and
 * held at the edge for every visitor, so a deck shuffled during construction
 * would hand them all the same first card — and the browser, shuffling its own
 * while hydrating, would disagree with the markup it was given. The component
 * calls `restore` or `reset` once it has mounted instead.
 */
export class GameState {
	#roster: Player[];
	// Cards are keyed by draw, not by player: a recycled player gets a fresh
	// card element, so no card on screen ever mutates its face. The counter
	// never resets (not even on Play Again) so a key can't collide with a
	// still-transitioning element from the previous game.
	#nextKey = 0;

	difficulty = $state(savedDifficulty());

	/** False until the first deal or a restore. `current` being null isn't
	 *  enough to tell: it is also null once the game is over. */
	dealt = $state(false);

	/** Face-down draw pile; the top card gets dealt into `current`. */
	deck = $state<Player[]>([]);
	/** Players whose card resolved without them being identified; reshuffled
	 *  into a fresh deck when the draw pile runs out. */
	recycle = $state<Player[]>([]);
	identified = $state<number[]>([]);
	guesses = $state(0);
	/** The drawn card being guessed at; null before the first deal, and again
	 *  once both piles run dry (game over). */
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

		// Stored from the first game, before anything is chosen, so storage always
		// holds the difficulty in play: the default on a first visit, and a valid
		// value in place of one savedDifficulty() had to discard.
		saveDifficulty(this.difficulty);

		// Known without shuffling anything, so the progress line is already right
		// in the server's markup.
		this.identified = preIdentifiedIds(roster);
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
	 * where nobody has a number deals no cards, so it starts (and stays) with no
	 * current card instead of crashing on a question that can't be built. The
	 * page doesn't start a game for one — see isPlayable in game.ts.
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
		this.dealt = true;
	}

	/**
	 * Pick a saved game back up, if storage holds one this roster could have
	 * reached. Returns whether it did; the caller deals a fresh game otherwise.
	 * Anything unusable is removed on the way past rather than left to be
	 * rejected on every visit.
	 *
	 * The guessed pile comes back empty: the last guess isn't news any more, and
	 * a card arriving on the pile is what the page animates and announces.
	 */
	restore(storage: GameStorage | null, teamId: string): boolean {
		if (!storage) return false;
		let saved: SavedGame | null;
		try {
			const raw = storage.getItem(saveKey(teamId));
			if (raw === null) return false;
			saved = parseSavedGame(raw, this.#roster);
			if (!saved) storage.removeItem(saveKey(teamId));
		} catch {
			return false;
		}
		if (!saved) return false;

		const find = (id: number) => this.#roster.find((p) => p.id === id);
		const players = (ids: number[]) => ids.flatMap((id) => find(id) ?? []);
		const player = saved.current && find(saved.current.id);

		this.deck = players(saved.deck);
		this.recycle = players(saved.recycle);
		this.identified = saved.identified;
		this.guesses = saved.guesses;
		this.resolved = null;
		this.previous = null;
		if (saved.current && player) {
			// The saved answers are kept so a refresh shows the same card it left,
			// unless the difficulty was changed in the meantime (in another tab, say)
			// and they are no longer the right number of them.
			const remaining = this.#roster.length - saved.identified.length;
			const expected = Math.min(this.difficulty, remaining);
			this.current = {
				key: this.#nextKey++,
				player,
				optionIds:
					saved.current.options.length === expected
						? saved.current.options
						: cardOptions(this.#roster, saved.identified, player, this.difficulty)
			};
		} else {
			this.current = null;
		}
		this.dealt = true;
		return true;
	}

	/**
	 * Write the game to storage, or clear its entry while there is nothing to
	 * keep — a game with no guesses in it, which is also what Play Again leaves.
	 * So storage holds nothing for a team until somebody has actually played.
	 *
	 * Guarded like the difficulty setting above: a full or blocked store costs
	 * the saved game, never the game being played.
	 */
	save(storage: GameStorage | null, teamId: string): void {
		if (!storage || !this.dealt) return;
		try {
			if (this.guesses === 0) {
				storage.removeItem(saveKey(teamId));
				return;
			}
			const saved: SavedGame = {
				v: SAVE_VERSION,
				roster: rosterSignature(this.#roster),
				identified: [...this.identified],
				guesses: this.guesses,
				deck: this.deck.map((p) => p.id),
				recycle: this.recycle.map((p) => p.id),
				current: this.current && {
					id: this.current.player.id,
					options: [...this.current.optionIds]
				}
			};
			storage.setItem(saveKey(teamId), JSON.stringify(saved));
		} catch {
			// The game carries on in memory.
		}
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
		saveDifficulty(value);
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
