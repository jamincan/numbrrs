import { browser } from '$app/env';
import {
	buildDeck,
	cardOptions,
	DEFAULT_LEVEL,
	drawCard,
	GROUP_SIZE,
	isLevelKey,
	learnOptions,
	levelFor,
	lowerLevel,
	preIdentifiedIds,
	QUIZ_AFTER_MAX,
	QUIZ_AFTER_MIN,
	reinsertCard,
	REVIEWS_PER_GROUP,
	shuffle,
	type Level,
	type LevelKey,
	type Medal,
	type Step
} from '#lib/game.ts';
import type { Player } from '#lib/types.ts';

// Named for what it held before the levels had names: the number of answers on
// a card. The key is kept so a returning visitor's setting carries over, and
// because the privacy page names it.
const LEVEL_STORAGE_KEY = 'numbrrs_difficulty';

// Set once the hint that points out the level menu has been sent away, so
// that it is not shown again. The privacy page names this key too.
const LEVEL_HINT_KEY = 'numbrrs_level_hint';

/** What the setting used to be stored as, and the level nearest each one. */
const LEGACY_LEVELS: Partial<Record<string, LevelKey>> = {
	'2': 'learn',
	'4': 'easy',
	'8': 'medium',
	Infinity: 'hard'
};

/** Learn's final lap: the same three names to choose from, with the book shut. */
const LAP_LEVEL: Level = { ...levelFor('learn'), closedBook: true };

/** How many mix-ups are remembered; the oldest are dropped past this. */
const MAX_CONFUSIONS = 60;

// The quiz is a physical deck. A card is drawn from the pile and shows its
// number; a guess flips it and sends it to the guessed pile, where it stays
// readable while the next card is already up — so there is no reveal phase
// that blocks play, and no auto-advance timer.
//
// In Learn a player's first card is an introduction: dealt face up, with
// nothing to answer, and put back into the pile as a question once it has
// been looked at.
export type ActiveCard = {
	key: number;
	kind: 'intro' | 'quiz';
	player: Player;
	optionIds: number[];
	/** See `Step.again`. */
	again: boolean;
};
/** `picked` is whoever was wrongly chosen for the card, so their own number
 *  can be shown beside the right answer; null after a right guess. */
export type ResolvedCard = { key: number; player: Player; correct: boolean; picked: Player | null };

/**
 * Where a game of Learn has got to. `learn` is the roster being introduced, a
 * few players at a time, with the roster as an open book. `lap` is the final
 * lap: every player once more, with the book shut, which is what the score is
 * taken from. Null at the quiz levels, which are one closed-book run.
 */
export type Phase = 'learn' | 'lap' | null;

// Reading and writing are both wrapped because localStorage throws rather
// than degrading when storage is unavailable — Safari private browsing, site
// data blocked, iOS under storage pressure. The first write happens while the
// game is being constructed, so an unguarded throw wouldn't just lose the
// setting, it would take the whole game down with it. Someone who can't
// persist a preference should still be able to play.
//
// Anything unexpected in storage (a hand-edited value) falls back to Learn.
function savedLevel(): LevelKey {
	if (!browser) return DEFAULT_LEVEL;
	try {
		const stored = localStorage.getItem(LEVEL_STORAGE_KEY);
		if (isLevelKey(stored)) return stored;
		return (stored !== null && LEGACY_LEVELS[stored]) || DEFAULT_LEVEL;
	} catch {
		return DEFAULT_LEVEL;
	}
}

/**
 * Whether the hint about the level menu has been sent away in this browser.
 * Where storage can't be read it has not, as far as anyone can tell: the hint
 * is shown, and sending it away lasts for the page.
 */
export function levelHintSeen(): boolean {
	if (!browser) return false;
	try {
		return localStorage.getItem(LEVEL_HINT_KEY) !== null;
	} catch {
		return false;
	}
}

export function markLevelHintSeen(): void {
	if (!browser) return;
	try {
		localStorage.setItem(LEVEL_HINT_KEY, '1');
	} catch {
		// Then it is only gone for this page.
	}
}

function saveLevel(value: LevelKey): void {
	if (!browser) return;
	try {
		localStorage.setItem(LEVEL_STORAGE_KEY, value);
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
const SAVE_VERSION = 3;

/**
 * One entry per team. The id carries no locale, so /game/… and /fr/game/… share
 * a saved game — switching language keeps it.
 */
export function saveKey(teamId: string): string {
	return SAVE_KEY_PREFIX + teamId;
}

/** A card in the pile as it is stored: `i`ntroduction or `q`uestion, whose,
 *  and whether it is the question that follows a miss in the final lap. */
type SavedStep = { k: 'i' | 'q'; id: number; a?: true };

/** A game as it is written to storage: player ids only, in pile order. The
 *  guessed pile is left out on purpose — see `restore`. */
type SavedGame = {
	v: typeof SAVE_VERSION;
	roster: string;
	/** The level the card that's up was dealt at. */
	level: LevelKey;
	/** The level the run counts as: the easiest one used during it. */
	countsAs: LevelKey;
	phase: Phase;
	/** Learn about part of the roster: the players it is for. See `GameState.focus`. */
	focus: number[] | null;
	identified: number[];
	/** Players whose card has been answered wrongly at least once. */
	missed: number[];
	guesses: number;
	deck: SavedStep[];
	/** Learn: players not yet dealt into a batch. */
	waiting: number[];
	/** Learn: players whose introduction has been looked at. */
	introduced: number[];
	/** Pairs of players one of whom was picked for the other's card. */
	confusions: [number, number][];
	current: (SavedStep & { options: number[] }) | null;
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

function isId(value: unknown): value is number {
	return typeof value === 'number' && Number.isSafeInteger(value);
}

function isIdList(value: unknown): value is number[] {
	return Array.isArray(value) && value.every(isId);
}

const unique = (ids: readonly number[]) => new Set(ids).size === ids.length;

function parseStep(value: unknown): SavedStep | null {
	if (typeof value !== 'object' || value === null) return null;
	const { k, id, a } = value as Record<string, unknown>;
	if ((k !== 'i' && k !== 'q') || !isId(id)) return null;
	if (a !== undefined && a !== true) return null;
	return a ? { k, id, a } : { k, id };
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
	const stored = data as Record<string, unknown>;
	const { level, countsAs, phase, identified, missed, guesses, waiting, introduced } = stored;

	const signature = rosterSignature(roster);
	if (stored.v !== SAVE_VERSION || stored.roster !== signature) return null;
	if (!isIdList(identified) || !isIdList(missed)) return null;
	if (!isIdList(waiting) || !isIdList(introduced)) return null;
	if (typeof guesses !== 'number' || !Number.isSafeInteger(guesses) || guesses < 0) return null;

	// A run counts as the easiest level it used, so never as a harder one than
	// the one in play — and Learn and the quiz levels are never mixed in a run.
	if (!isLevelKey(level) || !isLevelKey(countsAs)) return null;
	if (lowerLevel(countsAs, level) !== countsAs) return null;
	const learning = !levelFor(level).closedBook;
	if (levelFor(countsAs).closedBook === learning) return null;
	// Learn is always in one of its two phases; a quiz level has none.
	const lap = phase === 'lap';
	if (learning ? phase !== 'learn' && !lap : phase !== null) return null;
	const savedPhase: Phase = learning ? (lap ? 'lap' : 'learn') : null;

	if (!Array.isArray(stored.deck)) return null;
	const deck: SavedStep[] = [];
	for (const item of stored.deck) {
		const step = parseStep(item);
		if (!step) return null;
		deck.push(step);
	}
	// Far more cards than any game holds: a pile this long is not one the game
	// built, and is not worth dealing.
	if (deck.length > roster.length * 4 + 8) return null;

	let current: SavedGame['current'] = null;
	if (stored.current !== null) {
		const step = parseStep(stored.current);
		const options = (stored.current as Record<string, unknown> | undefined)?.options;
		if (!step || !isIdList(options)) return null;
		current = { ...step, options };
	}

	const preIdentified = preIdentifiedIds(roster);
	const numbered = new Set(roster.filter((p) => p.sweaterNumber != null).map((p) => p.id));
	const onRoster = new Set(roster.map((p) => p.id));
	const cards = current ? [current, ...deck] : deck;

	// A game about part of the roster is a round of Learn. Everyone it is not
	// about counts as found, and as introduced, from its first card.
	let focus: number[] | null = null;
	if (stored.focus !== null) {
		if (!learning || !isIdList(stored.focus) || stored.focus.length === 0) return null;
		if (!unique(stored.focus) || !stored.focus.every((id) => numbered.has(id))) return null;
		focus = stored.focus;
	}
	const outside = focus ? [...numbered].filter((id) => !focus.includes(id)) : [];
	if (!outside.every((id) => identified.includes(id))) return null;
	if (missed.some((id) => outside.includes(id))) return null;

	// Players with no number are found from the start and never dealt; nobody
	// is found twice; only a player with a number has a card, or can be missed.
	if (!unique(identified) || !identified.every((id) => onRoster.has(id))) return null;
	if (!preIdentified.every((id) => identified.includes(id))) return null;
	if (!unique(missed) || !missed.every((id) => numbered.has(id))) return null;
	if (!cards.every((card) => numbered.has(card.id))) return null;
	if (!unique(waiting) || !unique(introduced)) return null;
	const found = identified.length - preIdentified.length - outside.length;

	if (current) {
		const { options } = current;
		if (!unique(options) || !options.every((id) => numbered.has(id))) return null;
		// A question's own player is among its answers; an introduction has none.
		if (current.k === 'q' ? !options.includes(current.id) : options.length > 0) return null;
	} else if (deck.length > 0 || waiting.length > 0 || phase === 'learn') {
		// No card up with cards still to come is not a state the game passes through.
		return null;
	}

	const questions = cards.filter((card) => card.k === 'q').map((card) => card.id);
	const unfound = [...numbered].filter((id) => !identified.includes(id));

	if (phase === 'learn') {
		// Every player with a number is in exactly one place: waiting for a batch,
		// dealt but not yet looked at, or introduced.
		const pending = cards.filter((card) => card.k === 'i').map((card) => card.id);
		const placed = [...waiting, ...pending, ...introduced];
		if (placed.length !== numbered.size || !unique(placed)) return null;
		if (!placed.every((id) => numbered.has(id))) return null;
		// Only someone introduced is asked about, offered as an answer, or
		// learned; and everyone introduced but not yet learned has a question
		// coming, or they never would be.
		if (!questions.every((id) => introduced.includes(id))) return null;
		if (!identified.every((id) => preIdentified.includes(id) || introduced.includes(id))) {
			return null;
		}
		if (current && !current.options.every((id) => introduced.includes(id))) return null;
		if (!introduced.every((id) => identified.includes(id) || questions.includes(id))) return null;
		if (!outside.every((id) => introduced.includes(id))) return null;
		// Misses are only scored in the final lap.
		if (missed.length > 0 || cards.some((card) => card.a)) return null;
	} else {
		// One closed-book run, at a quiz level or as Learn's final lap: nothing
		// but questions, one for each player still to be found and none for
		// anyone who has been.
		if (waiting.length > 0 || cards.some((card) => card.k === 'i')) return null;
		if (!unique(questions)) return null;
		if (questions.length !== unfound.length) return null;
		if (!questions.every((id) => unfound.includes(id))) return null;
		if (phase === null && cards.some((card) => card.a)) return null;
		// Each right guess finds exactly one player and each player missed took
		// at least one wrong one — so there can't be more of either than there
		// were guesses to produce them.
		if (guesses < found + missed.length) return null;
	}

	// Mix-ups only steer which wrong answers are offered, so one that makes no
	// sense is left out rather than costing the game.
	const confusions: [number, number][] = [];
	if (Array.isArray(stored.confusions)) {
		for (const pair of stored.confusions.slice(-MAX_CONFUSIONS)) {
			if (isIdList(pair) && pair.length === 2 && pair.every((id) => numbered.has(id))) {
				confusions.push([pair[0]!, pair[1]!]);
			}
		}
	}

	return {
		v: SAVE_VERSION,
		roster: signature,
		level,
		countsAs,
		phase: savedPhase,
		focus,
		identified,
		missed,
		guesses,
		deck,
		waiting,
		introduced,
		confusions,
		current
	};
}

/**
 * The quiz's state and the moves that change it: dealing, guessing, and
 * switching level mid-game. `roster` is fixed for the life of an instance —
 * the page remounts this whenever the roster it's for changes (see
 * RosterGame.svelte), so nothing here needs to react to it changing.
 *
 * A new instance has dealt nothing. The page is rendered on the server and
 * held at the edge for every visitor, so a deck shuffled during construction
 * would hand them all the same first card — and the browser, shuffling its own
 * while hydrating, would disagree with the markup it was given. The component
 * calls `restore` or `reset` once it has mounted instead.
 */
export class GameState {
	#roster: Player[];
	#numbered: Player[];
	#preIdentified: number[];
	// Cards are keyed by draw, not by player: a card that comes round again gets
	// a fresh card element, so no card on screen ever mutates its face. The
	// counter never resets (not even on Play Again) so a key can't collide with
	// a still-transitioning element from the previous game.
	#nextKey = 0;

	level = $state<LevelKey>(savedLevel());
	/**
	 * The level this run counts as: the easiest one used since the first guess.
	 * Turning the level down for one hard card and back up again doesn't earn
	 * the harder level's medal.
	 */
	countsAs = $state<LevelKey>(this.level);
	phase = $state<Phase>(null);
	/**
	 * Learn, when it is about only some of the roster: the players it is for, by
	 * id. Everyone else counts as known from the start: shown with their numbers,
	 * offered as answers, and never dealt except to be asked about again beside
	 * the new ones. Null for a game about the whole roster, which every game at
	 * a quiz level is.
	 */
	focus = $state<number[] | null>(null);

	/** False until the first deal or a restore. `current` being null isn't
	 *  enough to tell: it is also null once the game is over. */
	dealt = $state(false);

	/** Face-down draw pile; the top card gets dealt into `current`. A card
	 *  answered wrongly goes back into it a few cards down. */
	deck = $state<Step<Player>[]>([]);
	/** Learn: players still to be dealt into a batch, in the order they will be. */
	waiting = $state<Player[]>([]);
	/** Learn: players whose introduction has been looked at. */
	introduced = $state<number[]>([]);
	/** Pairs of players, one of whom was picked for the other's card. Each is
	 *  then offered as an answer when the other comes up. */
	confusions = $state<[number, number][]>([]);
	identified = $state<number[]>([]);
	/** Players whose card has been answered wrongly at least once in the part
	 *  of the game that is scored: a quiz level's run, or Learn's final lap. */
	missed = $state<number[]>([]);
	guesses = $state(0);
	/** The drawn card; null before the first deal, and again once the game is
	 *  over. */
	current = $state<ActiveCard | null>(null);
	/** The most recent guess, face-up on top of the guessed pile. */
	resolved = $state<ResolvedCard | null>(null);
	/** The card underneath it — visible while the newest one flies in, and
	 *  peeking out at an angle after it lands. */
	previous = $state<ResolvedCard | null>(null);
	/**
	 * What the player last did, and how many times they have done anything: a
	 * guess, or moving on from an introduction. For announcing each move as it
	 * happens. A deal or a restore is neither, and leaves these alone.
	 */
	lastMove = $state<'guess' | 'next' | null>(null);
	moves = $state(0);

	readonly rosterLength: number;

	constructor(roster: Player[]) {
		this.#roster = roster;
		this.#numbered = roster.filter((p) => p.sweaterNumber != null);
		this.#preIdentified = preIdentifiedIds(roster);
		this.rosterLength = roster.length;

		// Stored from the first game, before anything is chosen, so storage always
		// holds the level in play: the default on a first visit, and a current
		// value in place of one savedLevel() had to translate or discard.
		saveLevel(this.level);

		// Known without shuffling anything, so the progress line is already right
		// in the server's markup.
		this.identified = [...this.#preIdentified];
	}

	#find(id: number): Player | undefined {
		return this.#roster.find((p) => p.id === id);
	}

	// In the order the card chose — deriving this by filtering the roster would
	// quietly re-impose roster order on a shuffled card.
	get activeOptions(): Player[] {
		return this.current ? this.current.optionIds.flatMap((id) => this.#find(id) ?? []) : [];
	}

	/** Whether the roster keeps its numbers to itself: at a quiz level, and in
	 *  Learn's final lap. See `Level.closedBook`. */
	get closedBook(): boolean {
		return levelFor(this.level).closedBook || this.phase === 'lap';
	}

	/** How many players are still to be found: in Learn, still to be learned,
	 *  and then in the final lap still to be named. */
	get remaining(): number {
		return this.rosterLength - this.identified.length;
	}

	/** How many players were, or still can be, found without a miss. */
	get firstTry(): number {
		return this.guessableCount - this.missed.length;
	}

	/** The players this game asks about: everyone with a number, or the few a
	 *  round of Learn is focused on. */
	#scope(): Player[] {
		const focus = this.focus;
		return focus ? this.#numbered.filter((p) => focus.includes(p.id)) : this.#numbered;
	}

	/** Everyone found from the start: those with no number to be asked about,
	 *  and those a focused round is not about. */
	#base(): number[] {
		const scope = this.#scope();
		return this.#roster.filter((p) => !scope.includes(p)).map((p) => p.id);
	}

	/** How many players the game asks about. */
	get guessableCount(): number {
		return this.#scope().length;
	}

	/** One entry per player found, in the order they were: whether it took no
	 *  wrong answer to get there. */
	get outcomes(): boolean[] {
		const base = this.#base();
		return this.identified
			.filter((id) => !base.includes(id))
			.map((id) => !this.missed.includes(id));
	}

	/** Everyone missed this run, in roster order. */
	get missedPlayers(): Player[] {
		return this.#roster.filter((p) => this.missed.includes(p.id));
	}

	/** The medal a perfect run at this level is worth, if it is worth one. */
	get stake(): Medal | null {
		return levelFor(this.countsAs).medal;
	}

	/** Whether that medal is still there to be won — or, once the game is
	 *  over, has been. */
	get perfect(): boolean {
		return this.missed.length === 0;
	}

	/** Players whose numbers are on show from the last guess: see cardOptions. */
	#onShow(): number[] {
		const resolved = this.resolved;
		if (!resolved) return [];
		return resolved.picked ? [resolved.player.id, resolved.picked.id] : [resolved.player.id];
	}

	/** Everyone a player has been mixed up with, whichever way round it was. */
	#confusedWith(id: number): number[] {
		return this.confusions.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));
	}

	/** The answers for a question about `player`, as the game stands. */
	#options(player: Player): number[] {
		const avoid = this.#onShow();
		const prefer = this.#confusedWith(player.id);
		if (this.phase === 'learn') {
			const introduced = this.#numbered.filter((p) => this.introduced.includes(p.id));
			return learnOptions(introduced, player, LAP_LEVEL.choices, undefined, avoid, prefer);
		}
		const level = this.phase === 'lap' ? LAP_LEVEL : levelFor(this.level);
		return cardOptions(this.#roster, this.identified, player, level, undefined, avoid, prefer);
	}

	/**
	 * Learn, with nothing left in the pile: deal the next batch of players, or
	 * once everyone has been through one, start the final lap.
	 */
	#refill(): void {
		if (this.phase !== 'learn') return;
		if (this.waiting.length > 0) {
			const batch = this.waiting.slice(0, GROUP_SIZE);
			this.waiting = this.waiting.slice(GROUP_SIZE);
			let deck: Step<Player>[] = batch.map((player) => ({ kind: 'intro', player }));
			// A few of the players learned in earlier batches come round again with
			// each new one, spaced out among the introductions.
			const learned = shuffle(this.#numbered.filter((p) => this.identified.includes(p.id)));
			learned.slice(0, REVIEWS_PER_GROUP).forEach((player, i) => {
				const at = Math.min(deck.length, 2 + i * 2);
				deck = [...deck.slice(0, at), { kind: 'quiz', player }, ...deck.slice(at)];
			});
			this.deck = deck;
			return;
		}
		// The final lap is a closed-book run of its own: everyone is to be found
		// again, and this time a miss counts.
		this.phase = 'lap';
		this.identified = this.#base();
		this.missed = [];
		this.deck = buildDeck(this.#scope()).map((player) => ({ kind: 'quiz', player }));
	}

	/** Turn up the top card of the pile, refilling it first if Learn has more
	 *  to deal. No card means the game is over. */
	#draw(): void {
		if (this.deck.length === 0) this.#refill();
		const drawn = drawCard(this.deck);
		if (!drawn) {
			this.current = null;
			return;
		}
		const { kind, player, again = false } = drawn.card;
		this.deck = drawn.deck;
		this.current = {
			key: this.#nextKey++,
			kind,
			player,
			again,
			optionIds: kind === 'intro' ? [] : this.#options(player)
		};
	}

	/**
	 * A fresh game: nothing guessed yet beyond the numberless players. A roster
	 * where nobody has a number deals no cards, so it starts (and stays) with no
	 * current card instead of crashing on a question that can't be built. The
	 * page doesn't start a game for one — see isPlayable in game.ts.
	 *
	 * `focus` makes it a round of Learn about those players only: the ones new
	 * to a roster somebody already knows. It is ignored at a quiz level, and
	 * when it names nobody on the roster or everybody on it.
	 */
	reset(focus?: readonly number[]) {
		const learning = !levelFor(this.level).closedBook;
		const wanted = this.#numbered.filter((p) => focus?.includes(p.id)).map((p) => p.id);
		const partial = learning && wanted.length > 0 && wanted.length < this.#numbered.length;
		this.focus = partial ? wanted : null;
		const base = this.#base();
		const order = buildDeck(this.#scope());
		this.countsAs = this.level;
		this.phase = learning ? 'learn' : null;
		// Learn deals its players a batch at a time, so the pile starts empty and
		// the first draw fills it. A quiz level deals everyone at once.
		this.waiting = learning ? order : [];
		this.deck = learning ? [] : order.map((player) => ({ kind: 'quiz', player }));
		// Whoever a focused round is not about has been met already.
		this.introduced = base.filter((id) => !this.#preIdentified.includes(id));
		this.confusions = [];
		this.identified = base;
		this.missed = [];
		this.guesses = 0;
		this.resolved = null;
		this.previous = null;
		this.lastMove = null;
		this.#draw();
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
			// The level may have been changed since, on another team's page or in
			// another tab. Between Learn and a quiz level that is a restart, the
			// same as making the change mid-game — see setLevel.
			if (saved?.current && levelFor(saved.level).closedBook !== levelFor(this.level).closedBook) {
				saved = null;
			}
			if (!saved) storage.removeItem(saveKey(teamId));
		} catch {
			return false;
		}
		if (!saved) return false;

		const players = (ids: number[]) => ids.flatMap((id) => this.#find(id) ?? []);
		const steps = (cards: SavedStep[]): Step<Player>[] =>
			cards.flatMap((card) => {
				const player = this.#find(card.id);
				if (!player) return [];
				const step: Step<Player> = { kind: card.k === 'i' ? 'intro' : 'quiz', player };
				return card.a ? [{ ...step, again: true }] : [step];
			});

		this.phase = saved.phase;
		this.focus = saved.focus;
		this.deck = steps(saved.deck);
		this.waiting = players(saved.waiting);
		this.introduced = saved.introduced;
		this.confusions = saved.confusions;
		this.identified = saved.identified;
		this.missed = saved.missed;
		this.guesses = saved.guesses;
		this.resolved = null;
		this.previous = null;
		this.lastMove = null;

		const [card] = saved.current ? steps([saved.current]) : [];
		if (saved.current && card) {
			// The saved answers are kept so a refresh shows the same card it left,
			// unless the level was changed in the meantime, or they are not the
			// number of answers it would deal. The run then counts as the easier of
			// the two levels.
			this.countsAs = lowerLevel(saved.countsAs, this.level);
			const dealt = card.kind === 'intro' ? [] : this.#options(card.player);
			const kept = saved.level === this.level && saved.current.options.length === dealt.length;
			this.current = {
				key: this.#nextKey++,
				kind: card.kind,
				player: card.player,
				again: card.again ?? false,
				optionIds: kept ? saved.current.options : dealt
			};
		} else {
			// Finished: it counts as what it was played at, whatever the setting
			// has been moved to since.
			this.countsAs = saved.countsAs;
			this.current = null;
		}
		this.dealt = true;
		return true;
	}

	/**
	 * Write the game to storage, or clear its entry while there is nothing to
	 * keep — a game nothing has been done in, which is also what Play Again
	 * leaves. So storage holds nothing for a team until somebody has actually
	 * played.
	 *
	 * Guarded like the level setting above: a full or blocked store costs the
	 * saved game, never the game being played.
	 */
	save(storage: GameStorage | null, teamId: string): void {
		if (!storage || !this.dealt) return;
		try {
			if (this.guesses === 0 && this.introduced.length === 0) {
				storage.removeItem(saveKey(teamId));
				return;
			}
			const step = ({ kind, player, again }: Step<Player>): SavedStep => {
				const saved: SavedStep = { k: kind === 'intro' ? 'i' : 'q', id: player.id };
				return again ? { ...saved, a: true } : saved;
			};
			const saved: SavedGame = {
				v: SAVE_VERSION,
				roster: rosterSignature(this.#roster),
				// A finished game has no card up, so nothing was dealt at the
				// setting it has since been moved to: it is saved as what it was.
				level: this.current ? this.level : this.countsAs,
				countsAs: this.countsAs,
				phase: this.phase,
				focus: this.focus && [...this.focus],
				identified: [...this.identified],
				missed: [...this.missed],
				guesses: this.guesses,
				deck: this.deck.map(step),
				waiting: this.waiting.map((p) => p.id),
				introduced: [...this.introduced],
				confusions: this.confusions.map(([a, b]) => [a, b]),
				current: this.current && {
					...step(this.current),
					options: [...this.current.optionIds]
				}
			};
			storage.setItem(saveKey(teamId), JSON.stringify(saved));
		} catch {
			// The game carries on in memory.
		}
	}

	/**
	 * Move on from an introduction. The player has now been seen, so can be
	 * asked about and offered as an answer; their first question goes into the
	 * pile a couple of cards down, soon enough that the face-up card is still
	 * in mind.
	 */
	next() {
		const card = this.current;
		if (!card || card.kind !== 'intro') return;
		this.introduced = [...this.introduced, card.player.id];
		this.deck = reinsertCard<Step<Player>>(
			this.deck,
			{ kind: 'quiz', player: card.player },
			undefined,
			QUIZ_AFTER_MIN,
			QUIZ_AFTER_MAX
		);
		this.lastMove = 'next';
		this.moves += 1;
		this.#draw();
	}

	guess(playerId: number) {
		const card = this.current;
		if (!card || card.kind !== 'quiz') return;
		const guessed = this.#find(playerId);
		const answer = card.player.sweaterNumber;
		const question: Step<Player> = { kind: 'quiz', player: card.player };
		// Teams regularly carry two players on one number over a season — someone
		// departs and their replacement takes the sweater. The card only shows a
		// number, so every player wearing it is a right answer; picking the one the
		// card wasn't built from isn't a mistake.
		const correct = guessed != null && answer != null && guessed.sweaterNumber === answer;
		let deck = this.deck;

		if (!correct) {
			// Remembered, so each is offered when the other next comes up.
			if (guessed) {
				this.confusions = [
					...this.confusions,
					[card.player.id, guessed.id] as [number, number]
				].slice(-MAX_CONFUSIONS);
			}
			// A miss only counts where the score is taken: not while Learn is
			// still introducing the roster, which is what misses there are for.
			if (this.phase !== 'learn' && !this.missed.includes(card.player.id)) {
				this.missed = [...this.missed, card.player.id];
			}
			// Back a few cards down, to be asked again while the correction is
			// fresh. In the final lap that next right answer won't be the last
			// word: see `Step.again`.
			deck = reinsertCard(deck, this.phase === 'lap' ? { ...question, again: true } : question);
		} else if (card.again) {
			// Right, straight after being told. Once more, at the bottom of the
			// pile, before it counts.
			deck = [...deck, question];
		} else {
			// Only the player actually picked is found, so the number's other
			// wearer still has to be named later. A closed book goes on offering
			// players who have been found, though, and one of those picked again
			// has nothing left to be found as: the card's own player is found
			// then, or the card would come round for ever.
			const found = this.identified.includes(guessed.id) ? card.player : guessed;
			const theirs = (step: Step<Player>) => step.kind === 'quiz' && step.player.id === found.id;
			if (deck.some((step) => theirs(step) && step.again)) {
				// Missed earlier in the final lap, and named now on the card of
				// the number's other wearer before their own came round. That is
				// the right answer straight after being told, on another card,
				// and like it is not the last word: their card goes to the bottom
				// of the pile for that, where it would have gone.
				deck = [...deck.filter((step) => !theirs(step)), { kind: 'quiz', player: found }];
			} else if (!this.identified.includes(found.id)) {
				this.identified = [...this.identified, found.id];
				// Their own question is done wherever it sits in the pile.
				deck = deck.filter((step) => !theirs(step));
			}
			// The card that was up is finished with only if its own player is now
			// found. Otherwise the right answer found the number's other wearer:
			// nothing to correct, so it goes to the bottom.
			if (!this.identified.includes(card.player.id)) deck = [...deck, question];
		}

		this.deck = deck;
		this.guesses += 1;
		this.previous = this.resolved;
		// Reveal whoever was picked when the guess was right, not whichever
		// player the card happened to be built from — showing the other one
		// reads as a correction when the answer was accepted.
		this.resolved = {
			key: card.key,
			player: correct ? guessed : card.player,
			correct,
			picked: correct ? null : (guessed ?? null)
		};
		this.lastMove = 'guess';
		this.moves += 1;
		// Dealt last, knowing what the guess has just put on show, so the next
		// card's options can try to leave those players out.
		this.#draw();
	}

	/**
	 * Change level. Between two quiz levels the card that's up stays the
	 * question and only its answers are dealt again; the run then counts as the
	 * easier of the levels it has used, unless nothing has been guessed yet, in
	 * which case it simply becomes a game at the new level.
	 *
	 * To or from Learn the game starts over. Learn is a different game, not a
	 * different number of answers: its cards are dealt in batches and its
	 * roster is an open book.
	 */
	setLevel(key: LevelKey) {
		const from = levelFor(this.level);
		const to = levelFor(key);
		this.level = key;
		saveLevel(key);
		if (!this.current || from.key === to.key) return;
		if (!from.closedBook || !to.closedBook) {
			this.reset();
			return;
		}
		this.countsAs = this.guesses === 0 ? key : lowerLevel(this.countsAs, key);
		this.current = { ...this.current, optionIds: this.#options(this.current.player) };
	}
}
