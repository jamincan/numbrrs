/**
 * Pure quiz logic, kept out of the component so it can be unit tested.
 * `random` is injectable for deterministic tests and defaults to Math.random.
 */

/** The fields the quiz needs from a player; the DB row satisfies this. */
export interface GamePlayer {
	id: number;
	sweaterNumber: number | null;
}

export interface Question<P extends GamePlayer> {
	player: P;
	optionIds: number[];
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
 * Build the next question: a random not-yet-identified player, plus enough
 * other unidentified players to fill out the difficulty's option count.
 */
export function nextQuestion<P extends GamePlayer>(
	roster: readonly P[],
	correctGuesses: readonly number[],
	difficulty: number,
	random: () => number = Math.random
): Question<P> {
	const remaining = roster.filter((p) => !correctGuesses.includes(p.id));
	const player = remaining[Math.floor(random() * remaining.length)];
	const others = shuffle(
		remaining.filter((p) => p.id !== player.id),
		random
	);
	const numOptions = Math.min(difficulty, remaining.length);
	const optionIds = shuffle(
		[player.id, ...others.slice(0, numOptions - 1).map((p) => p.id)],
		random
	);
	return { player, optionIds };
}
