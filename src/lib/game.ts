/**
 * Pure quiz logic, kept out of the component so it can be unit tested.
 * `random` is injectable for deterministic tests and defaults to Math.random.
 */

/** The fields the quiz needs from a player; the DB row satisfies this. */
export interface GamePlayer {
	id: number;
	sweaterNumber: number | null;
}

/** Fisher–Yates, in place. Returns the array for convenience. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

/**
 * Players without a sweater number can't be guessed by number, so they start
 * already-identified (shown green/unselectable with "--").
 */
export function preIdentifiedIds(roster: readonly GamePlayer[]): number[] {
	return roster.filter((p) => p.sweaterNumber == null).map((p) => p.id);
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
 * Draw the top card. When the draw pile is empty, the recycle pile — players
 * whose cards resolved without them being identified — shuffles over to become
 * the new deck, matching the rule that a wrongly-guessed player stays in the
 * pool until found. Returns null when both piles are exhausted: the game is
 * over. Inputs are not mutated.
 */
export function drawCard<P extends GamePlayer>(
	deck: readonly P[],
	recycle: readonly P[],
	random: () => number = Math.random
): { player: P; deck: P[]; recycle: P[] } | null {
	if (deck.length === 0) {
		if (recycle.length === 0) return null;
		return drawCard(shuffle([...recycle], random), [], random);
	}
	const [player, ...rest] = deck;
	return { player, deck: rest, recycle: [...recycle] };
}

/**
 * Answer options for a drawn card: its player plus enough other unidentified
 * players to fill out the difficulty's option count, shuffled.
 */
export function cardOptions<P extends GamePlayer>(
	roster: readonly P[],
	identified: readonly number[],
	player: P,
	difficulty: number,
	random: () => number = Math.random
): number[] {
	const remaining = roster.filter((p) => !identified.includes(p.id));
	const others = shuffle(
		remaining.filter((p) => p.id !== player.id),
		random
	);
	const numOptions = Math.min(difficulty, remaining.length);
	return shuffle([player.id, ...others.slice(0, numOptions - 1).map((p) => p.id)], random);
}
