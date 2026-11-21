import type { Gender } from './index';

/** Position codes the app has names for; anything else falls back to the code. */
export type PositionCode = 'C' | 'L' | 'R' | 'F' | 'D' | 'G';

/** The forward positions, grouped together in the roster view. */
export const FORWARD_POSITION_CODES: readonly PositionCode[] = ['L', 'C', 'R', 'F'];

/**
 * Every position the roster view groups explicitly (forwards, plus defense
 * and goalies). Anything not in this set falls into its "other" group —
 * declared as a superset of `FORWARD_POSITION_CODES` rather than a second
 * independent list, so the two can't silently drift apart.
 */
export const KNOWN_POSITION_CODES: readonly PositionCode[] = [...FORWARD_POSITION_CODES, 'D', 'G'];

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
	/** The link that jumps past the site nav, first in the tab order. */
	skipToContent: string;
	/** Accessible names that tell the page's two navigation landmarks apart. */
	nav: {
		main: string;
		footer: string;
	};

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
		/** Accessible name for the difficulty menu. */
		difficultyLabel: string;
		/** Accessible name for the button that opens it; `level` is the current
		 *  setting, which is also the button's visible text. */
		difficultyCurrent: (level: string) => string;
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
		/** Shown under the loading spinner when scripts are off: the roster only
		 *  ever arrives through one. */
		noScript: string;
		noRoster: string;
		retryRoster: string;
		identified: (found: number, total: number, gender: Gender) => string;
		/** Accessible name for the group of answer buttons. */
		answerChoices: string;
		/**
		 * Spoken after a guess, in place of the card flip: the verdict, then who
		 * wears the number. `name` is whoever the flipped card shows.
		 */
		guessResult: (correct: boolean, sweaterNumber: number, name: string) => string;
		/** Follows `guessResult` while there are cards left: the number now up. */
		nextNumber: (sweaterNumber: number) => string;
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

	footer: {
		/** Says the project is independent of the leagues whose marks it shows. */
		disclaimer: string;
		privacy: string;
		source: string;
	};

	privacy: {
		title: string;
		description: string;
		/** Lead paragraph — the short version, for anyone who reads no further. */
		summary: string;
		collectedTitle: string;
		/** Each entry is one thing recorded per page view. */
		collected: string[];
		hashTitle: string;
		hashBody: string;
		cookiesTitle: string;
		cookiesBody: string;
		errorsTitle: string;
		errorsBody: string;
		retentionTitle: string;
		retentionBody: string;
		sharingTitle: string;
		sharingBody: string;
		contactTitle: string;
		contactBody: string;
		/** ISO date the wording last changed, rendered in the page's locale. */
		updated: (date: string) => string;
	};

	error: {
		/** A URL that doesn't exist, or a league or team code that doesn't. */
		notFoundTitle: string;
		notFoundBody: string;
		/** Shown under the title when it was a league or team code that doesn't exist, to say which. */
		leagueNotFound: string;
		teamNotFound: string;
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
