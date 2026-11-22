/**
 * Pure quiz logic, kept out of the component so it can be unit tested.
 * `random` is injectable for deterministic tests and defaults to Math.random.
 */

import { FORWARD_POSITION_CODES } from '#lib/i18n/messages.ts';

/** The fields the quiz needs from a player; the DB row satisfies this. */
export interface GamePlayer {
	id: number;
	sweaterNumber: number | null;
}

export type LevelKey = 'learn' | 'easy' | 'medium' | 'hard';
export type Medal = 'bronze' | 'silver' | 'gold';

export interface Level {
	key: LevelKey;
	/** How many names a card offers; Infinity is everyone who has a number. */
	choices: number;
	/** What a run without a single miss earns at this level. */
	medal: Medal | null;
	/**
	 * A closed-book level never shows a number in the roster and draws its
	 * wrong answers from the whole roster, found or not, so the last card is as
	 * hard as the first. Learn is the open book: found players drop out of the
	 * answers and the roster fills in with their numbers.
	 */
	closedBook: boolean;
}

/** In order of difficulty, which is also the order of the menu. */
export const LEVELS: readonly Level[] = [
	{ key: 'learn', choices: 3, medal: null, closedBook: false },
	{ key: 'easy', choices: 5, medal: 'bronze', closedBook: true },
	{ key: 'medium', choices: 10, medal: 'silver', closedBook: true },
	{ key: 'hard', choices: Infinity, medal: 'gold', closedBook: true }
];

export const DEFAULT_LEVEL: LevelKey = 'learn';

export function isLevelKey(value: unknown): value is LevelKey {
	return LEVELS.some((level) => level.key === value);
}

export function levelFor(key: LevelKey): Level {
	// Every LevelKey is in LEVELS: the type is the list's own keys.
	return LEVELS.find((level) => level.key === key)!;
}

/** The level a medal is won at. */
export function levelForMedal(medal: Medal): Level {
	// Each medal belongs to exactly one level: see LEVELS.
	return LEVELS.find((level) => level.medal === medal)!;
}

/** Whichever of two levels is the easier: what a run that used both counts as. */
export function lowerLevel(a: LevelKey, b: LevelKey): LevelKey {
	const index = (key: LevelKey) => LEVELS.findIndex((level) => level.key === key);
	return index(a) <= index(b) ? a : b;
}

/** Fisher–Yates, in place. Returns the array for convenience. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		// i and j are always valid indices (i counts down from length - 1, j is
		// bounded by i + 1), so both reads are safe.
		const temp = items[i]!;
		items[i] = items[j]!;
		items[j] = temp;
	}
	return items;
}

// One collator for every roster, whatever language the page is in: the order
// is part of the server's markup, and the players' names are not translated.
const byName = new Intl.Collator('en', { sensitivity: 'base' });

/** Forwards, defence, goalies, then anything else: the roster view's groups. */
function positionRank(positionCode: string): number {
	if ((FORWARD_POSITION_CODES as readonly string[]).includes(positionCode)) return 0;
	if (positionCode === 'D') return 1;
	if (positionCode === 'G') return 2;
	return 3;
}

/**
 * The order a roster is shown in: by position group, then by name. A league's
 * feed may list its players by sweater number, and a roster shown in that
 * order gives each number away by where its player sits. So the order is
 * always this one, which says nothing about the numbers. Returns a new array.
 */
export function rosterOrder<
	P extends { firstName: string; lastName: string; positionCode: string }
>(roster: readonly P[]): P[] {
	return [...roster].sort(
		(a, b) =>
			positionRank(a.positionCode) - positionRank(b.positionCode) ||
			byName.compare(a.lastName, b.lastName) ||
			byName.compare(a.firstName, b.firstName)
	);
}

/**
 * Players without a sweater number can't be guessed by number, so they start
 * already-identified (shown green/unselectable with "--").
 */
export function preIdentifiedIds(roster: readonly GamePlayer[]): number[] {
	return roster.filter((p) => p.sweaterNumber == null).map((p) => p.id);
}

/**
 * Whether a roster gives the quiz anything to ask: at least one player with a
 * sweater number. A league can publish a roster before it has assigned any, and
 * a game dealt from one would open already finished.
 */
export function isPlayable(roster: readonly GamePlayer[]): boolean {
	return roster.some((p) => p.sweaterNumber != null);
}

/**
 * A fresh draw pile: one card per player who can be asked about (numberless
 * players start pre-identified instead of getting a card), in shuffled order.
 */
export function buildDeck<P extends GamePlayer>(
	roster: readonly P[],
	random: () => number = Math.random
): P[] {
	return shuffle(
		roster.filter((p) => p.sweaterNumber != null),
		random
	);
}

/**
 * One card in the draw pile. Most are questions: a number to put a name to.
 * In Learn a player's first card is an introduction instead, dealt face up
 * with nothing to answer.
 */
export interface Step<P> {
	kind: 'intro' | 'quiz';
	player: P;
	/**
	 * Set on a card that comes back after a miss in Learn's final lap: a right
	 * answer so soon after being told is short-term memory, so it is followed
	 * by one more, later, before the player counts as known.
	 */
	again?: boolean;
}

/**
 * Draw the top card. Returns null when the pile is empty. The input is not
 * mutated.
 */
export function drawCard<T>(deck: readonly T[]): { card: T; deck: T[] } | null {
	// deck.length > 0 is checked first, so index 0 exists.
	return deck.length === 0 ? null : { card: deck[0]!, deck: deck.slice(1) };
}

/** A missed card comes back after at least this many others, */
export const REINSERT_MIN = 3;
/** and at most this many, where the pile still holds that many. */
export const REINSERT_MAX = 5;

/** In Learn, how many new players are introduced before the next batch. */
export const GROUP_SIZE = 5;
/** A newly introduced player is first asked about after at least this many
 *  other cards, */
export const QUIZ_AFTER_MIN = 2;
/** and at most this many. */
export const QUIZ_AFTER_MAX = 3;
/** How many players already learned are asked about again with each new batch. */
export const REVIEWS_PER_GROUP = 2;

/**
 * Put a card back into the draw pile a few cards down, so a missed one comes
 * up again while the answer it was corrected with is still fresh: close enough
 * to be remembered, far enough not to be simply repeated. A pile shorter than
 * the gap takes it at the bottom. The input is not mutated.
 *
 * `min` and `max` are how many cards come before it; Learn uses a shorter gap
 * for the first question about a player just introduced.
 */
export function reinsertCard<T>(
	deck: readonly T[],
	card: T,
	random: () => number = Math.random,
	min = REINSERT_MIN,
	max = REINSERT_MAX
): T[] {
	const gap = min + Math.floor(random() * (max - min + 1));
	const at = Math.min(gap, deck.length);
	return [...deck.slice(0, at), card, ...deck.slice(at)];
}

/**
 * The player on the card and up to `count - 1` others from `pool`, shuffled.
 * Among the others, the ones in `preferIds` are taken first and the ones in
 * `avoidIds` last.
 */
function pickOptions<P extends GamePlayer>(
	pool: readonly P[],
	player: P,
	count: number,
	random: () => number,
	avoidIds: readonly number[],
	preferIds: readonly number[]
): number[] {
	const candidates = shuffle(
		pool.filter((p) => p.id !== player.id),
		random
	);
	const avoided = candidates.filter((p) => avoidIds.includes(p.id));
	const free = candidates.filter((p) => !avoidIds.includes(p.id));
	const ordered = [
		...free.filter((p) => preferIds.includes(p.id)),
		...free.filter((p) => !preferIds.includes(p.id)),
		...avoided
	];
	const others = ordered.slice(0, Math.max(0, count - 1));
	return shuffle([player.id, ...others.map((p) => p.id)], random);
}

/**
 * Answer options for a drawn card: its player plus enough others to fill out
 * the level's option count.
 *
 * In an open book the others are players not yet identified, so the choice
 * narrows as the roster is learned. In a closed-book level they are drawn from
 * everyone with a number, identified or not: the last card offers as many
 * names as the first.
 *
 * A level that offers only some of the candidates shuffles them. One that
 * offers them all in a closed book (Hard, or any level on a roster that small)
 * lists them in roster order instead, the same for every card, so a name is
 * found where it was last time rather than hunted for.
 *
 * `avoidIds` are players whose numbers are on show from the last guess: the
 * card just turned over, and whoever was wrongly picked for it. An option
 * built from one of them can be ruled out on sight rather than recalled, so
 * they're filled in last, only if there aren't enough other candidates to
 * reach the option count. Not always avoidable, but often is.
 *
 * `preferIds` are the opposite: players this one has been mixed up with
 * before, who make the most useful wrong answers and are filled in first.
 */
export function cardOptions<P extends GamePlayer>(
	roster: readonly P[],
	identified: readonly number[],
	player: P,
	level: Level,
	random: () => number = Math.random,
	avoidIds: readonly number[] = [],
	preferIds: readonly number[] = []
): number[] {
	const pool = level.closedBook
		? roster.filter((p) => p.sweaterNumber != null)
		: roster.filter((p) => !identified.includes(p.id));
	if (level.closedBook && level.choices >= pool.length) return pool.map((p) => p.id);
	const count = Math.min(level.choices, pool.length);
	return pickOptions(pool, player, count, random, avoidIds, preferIds);
}

/**
 * Answer options while Learn is still introducing a roster: the card's player
 * and others drawn only from players who have been introduced. A name nobody
 * has been shown yet is noise, not a choice; telling apart the ones that have
 * been is the thing being practised. Players already learned stay in the mix,
 * so earlier batches go on being distinguished from later ones.
 */
export function learnOptions<P extends GamePlayer>(
	introduced: readonly P[],
	player: P,
	choices: number,
	random: () => number = Math.random,
	avoidIds: readonly number[] = [],
	preferIds: readonly number[] = []
): number[] {
	const pool = introduced.some((p) => p.id === player.id) ? introduced : [...introduced, player];
	return pickOptions(pool, player, Math.min(choices, pool.length), random, avoidIds, preferIds);
}
