import type { LevelKey, Medal } from '#lib/game.ts';
import type { TrophyId } from '#lib/trophies.ts';
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
	/** Describes the link-preview image (static/og-image.png), whose own words
	 *  are English in both languages. */
	socialImageAlt: string;
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
		/** Read out for the count on a league's tab: teams held at gold this
		 *  season, out of the league's teams. */
		goldCount: (count: number, total: number) => string;
		/** On the tile of a team the visitor has completed: players on its
		 *  roster they have not named yet. */
		newPlayers: (count: number, gender: Gender) => string;
	};

	/** The trophies for winning a whole league, shown above the home page's
	 *  title to whoever holds them. */
	trophies: {
		/** Names the row of them. */
		title: string;
		names: Record<TrophyId, string>;
		/** What one was won for, shown on hovering over it and read out as its
		 *  name. `season` is the year the season started in. */
		tip: (trophy: TrophyId, season: number) => string;
	};

	/** The rules page. Its title also names the links to it. */
	howTo: {
		title: string;
		description: string;
		intro: string;
		levelsTitle: string;
		/** One line on each level, after its name and what its cards offer. */
		levels: Record<LevelKey, string>;
		/** What the three quiz levels have in common. */
		quizBody: string;
		missesTitle: string;
		missesBody: string;
		medalsTitle: string;
		medalsBody: string;
		/** Where medals show up once earned. */
		medalsWhere: string;
		/** Roster changes on a team already completed. */
		newTitle: string;
		newBody: string;
		seasonsTitle: string;
		seasonsBody: string;
		recordsTitle: string;
		recordsBody: string;
		/** Shown in place of the reset control when there is nothing to erase. */
		recordsEmpty: string;
		reset: string;
		/** The question the reset control asks before it does anything. */
		resetConfirm: string;
		resetYes: string;
		resetCancel: string;
		resetDone: string;
	};

	card: {
		prompt: string;
		correct: string;
		wrong: string;
	};

	game: {
		/** Meta description for a team's page; `team` arrives already localized. */
		description: (team: string) => string;
		/** Accessible name for the level menu. */
		levelLabel: string;
		/** Accessible name for the button that opens it; `level` is the current
		 *  setting, which is also the button's visible text. */
		levelCurrent: (level: string) => string;
		/** Under that button on a first visit: that the level can be changed.
		 *  One short line: it hangs over the top of the game. A link to the rules
		 *  follows it, named by their title. */
		levelHint: string;
		/** Sends the hint away. */
		levelHintDismiss: string;
		levels: Record<LevelKey, string>;
		/** A row of the level menu: the level's name, then what `levelChoices`
		 *  says its cards offer. */
		levelOption: (level: string, choices: string) => string;
		/** What a level's cards offer, after its name in the menu: `count` names
		 *  to choose from, or the whole roster when there is no count. */
		levelChoices: (count: number | null) => string;
		/** A medal by name, lower case: it is always read as part of a phrase. */
		medals: Record<Medal, string>;
		congratulations: string;
		allIdentified: (gender: Gender) => string;
		/** How many players are still to be found, under the cards. */
		remaining: (count: number) => string;
		/** Accessible name for the bar that shows the same thing. */
		progress: string;
		/** Accessible name for the medal beside the count while no card has been
		 *  missed; `medal` arrives from `medals`. */
		medalInReach: (medal: string) => string;
		/** The same, once one has. */
		medalLost: string;
		/** What a medal somebody holds was won for, shown on hovering over it and
		 *  read out in its place: `medal` arrives from `medals`, `level` from
		 *  `levels`, and `season` is the year the season started in. */
		medalTip: (medal: string, level: string, season: number) => string;
		/** Starts the game over, offered once the medal is out of reach. */
		restart: string;
		/** After a wrong guess: the number of the player who was picked. */
		wears: (name: string, sweaterNumber: number) => string;
		/** The final score: players found without a miss, out of all of them. */
		firstTry: (found: number, total: number) => string;
		/** Under the score of a run with no misses at a level that has a medal. */
		medalEarned: (medal: string) => string;
		/** Heads the list of players missed, once the game is over. */
		missedHeading: string;
		/** The best finished run this season at a level; `level` arrives from
		 *  `levels`. */
		best: (level: string, found: number, total: number) => string;
		playAgain: string;
		loadingRoster: string;
		/** Shown when scripts are off, under the undealt deck or the loading
		 *  spinner: the cards are only ever dealt, and a roster still being
		 *  fetched only ever arrives, through one. */
		noScript: string;
		noRoster: string;
		retryRoster: string;
		/** Accessible name for the group of answer buttons. */
		answerChoices: string;
		/**
		 * Spoken after a guess, in place of the card flip: the verdict, then who
		 * wears the number. `name` is whoever the flipped card shows.
		 */
		guessResult: (correct: boolean, sweaterNumber: number, name: string) => string;
		/** Follows `guessResult` while there are cards left: the number now up. */
		nextNumber: (sweaterNumber: number) => string;
		/** Spoken in its place when the card now up is an introduction, dealt
		 *  face up in Learn: who it is and what they wear. */
		introduced: (sweaterNumber: number, name: string) => string;
		/** The button that moves on from an introduction. */
		next: string;
		/** Under the cards while Learn is introducing the roster: players still
		 *  to be learned. */
		toLearn: (count: number) => string;
		/** The same line during Learn's final lap. */
		finalLap: (count: number) => string;
		/** Spoken as the final lap begins. */
		lapStart: string;
		/** On the end screen of Learn: go on to a quiz level; `level` arrives
		 *  from `levels`. */
		tryLevel: (level: string) => string;
		/** Beside the team's name when its roster has players new to the visitor:
		 *  starts a round of Learn about just those. */
		learnNew: (count: number, gender: Gender) => string;
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
