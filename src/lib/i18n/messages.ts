import type { Gender } from './index';

/** Position codes the app has names for; anything else falls back to the code. */
export type PositionCode = 'C' | 'L' | 'R' | 'F' | 'D' | 'G';

/**
 * The shape every catalogue implements. Declared explicitly rather than
 * inferred from the English one so that a locale can only ever be missing a
 * key, never quietly add one — and so English can drop the `gender` parameter
 * on messages that don't inflect, while French still receives it.
 */
export interface Messages {
	title: string;
	/** Meta description for the home page (and link previews of it). */
	description: string;
	tagline: string;
	/** Accessible name for the language switcher. */
	language: string;
	github: string;

	home: {
		league: string;
		chooseTeam: string;
		teamsSyncing: string;
	};

	card: {
		prompt: string;
		correct: string;
		wrong: string;
	};

	game: {
		/** Meta description for a team's page; `team` arrives already localized. */
		description: (team: string) => string;
		/** Accessible name for the difficulty selector. */
		difficultyLabel: string;
		difficulty: {
			easy: string;
			medium: string;
			hard: string;
			expert: string;
		};
		congratulations: string;
		allIdentified: (gender: Gender) => string;
		/** `percent` arrives already formatted for the locale. */
		accuracy: (percent: string) => string;
		playAgain: string;
		loadingRoster: string;
		noRoster: string;
		identified: (found: number, total: number, gender: Gender) => string;
		collapseRoster: string;
		expandRoster: string;
		hideRoster: string;
		showAll: string;
		groups: {
			forwards: (gender: Gender) => string;
			defense: (gender: Gender) => string;
			goalies: (gender: Gender) => string;
			other: string;
		};
	};

	positions: Record<PositionCode, (gender: Gender) => string>;

	error: {
		/** A URL that doesn't exist, or a league or team code that doesn't. */
		notFoundTitle: string;
		notFoundBody: string;
		/** Anything else — a thrown server error, rendered without detail. */
		genericTitle: string;
		genericBody: string;
		home: string;
		/**
		 * Labels the id a visitor can quote back. It identifies the fault rather
		 * than their particular visit, which is why it reads as a reference
		 * rather than as a case number.
		 */
		reference: string;
	};
}

/** A position's name, falling back to the raw code for anything unmapped. */
export function positionName(messages: Messages, code: string, gender: Gender): string {
	const name = messages.positions[code as PositionCode];
	return name ? name(gender) : code;
}
