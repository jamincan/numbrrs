import type { TrophyId } from '#lib/trophies.ts';
import type { Messages } from './messages';

const TROPHY_NAMES: Record<TrophyId, string> = {
	stanley: 'Stanley Cup',
	walter: 'Walter Cup',
	memorial: 'Memorial Cup',
	chynoweth: 'Ed Chynoweth Cup',
	robertson: 'J. Ross Robertson Cup',
	courteau: 'Gilles-Courteau Trophy'
};

/** Whose teams each is won by beating, as it reads before "team". */
const TROPHY_LEAGUES: Record<TrophyId, string> = {
	stanley: 'NHL',
	walter: 'PWHL',
	memorial: 'WHL, OHL and QMJHL',
	chynoweth: 'WHL',
	robertson: 'OHL',
	courteau: 'QMJHL'
};

export const en: Messages = {
	title: 'Numbrrs - Learn Hockey Jersey Numbers',
	description:
		'A flashcard game for learning hockey jersey numbers. Pick a team from the NHL, PWHL, WHL, OHL or QMJHL and guess who wears each number.',
	tagline: 'Learn hockey jersey numbers, one card at a time',
	socialImageAlt: 'Numbrrs: a flashcard game for learning hockey jersey numbers',
	language: 'Language',
	github: 'GitHub',
	skipToContent: 'Skip to content',
	nav: {
		main: 'Main',
		footer: 'Footer'
	},

	home: {
		league: 'League',
		chooseTeam: 'Choose a Team',
		teamsSyncing: 'Teams are still syncing from the league. Refresh in a moment.',
		goldCount: (count, total) => `gold for ${count} of ${total} teams`,
		newPlayers: (count) => `${count} new`
	},

	trophies: {
		title: 'Trophies',
		names: TROPHY_NAMES,
		tip: (trophy, season) =>
			`${TROPHY_NAMES[trophy]}: gold for every ${TROPHY_LEAGUES[trophy]} team, ${season}–${String(season + 1).slice(-2)} season`
	},

	howTo: {
		title: 'How to play',
		description:
			'How Numbrrs works: the four levels, what earns a medal, and where your records are kept.',
		intro:
			'Each card shows a team and a sweater number. Pick the player who wears it, and keep going until you have found everyone on the roster.',
		levelsTitle: 'Levels',
		levels: {
			learn:
				'The place to start with a team you don’t know. New players are dealt face up, five at a time, and you are asked about each one a few cards later. The roster is an open book while you learn: each player you get right is marked with their number. A final lap then asks about everyone once more with the numbers hidden, and that lap is your score.',
			easy: 'Five names on every card.',
			medium: 'Ten names on every card.',
			hard: 'Every card offers the whole roster.'
		},
		quizBody:
			'Easy, Medium and Hard are quizzes. The roster keeps its numbers to itself, and every card offers the full count of names however many players you have already found.',
		missesTitle: 'Misses',
		missesBody:
			'A wrong answer shows you who does wear the number, and the number of the player you picked instead. The card comes back a few cards later, and the game goes on until every player is found. Two players sometimes share a number over a season; either one is a right answer.',
		medalsTitle: 'Medals',
		medalsBody:
			'Find every player at a quiz level without a single miss and you earn its medal: bronze for Easy, silver for Medium, gold for Hard. The medal beside the count under the cards shows whether a perfect run is still on. After a miss you can restart, or carry on and finish the roster. Changing level partway through counts the run at the easier of the levels you used, and switching to or from Learn starts the game over.',
		medalsWhere:
			'Your best medal for a team shows on its tile on the home page and beside its name when you play it. Each league’s tab counts the teams you hold gold for.',
		newTitle: 'Roster changes',
		newBody:
			'Rosters change through a season. When a team you have played to the end adds a player or changes a number, its tile on the home page says how many are new to you, and the team’s page offers a short round of Learn about just those. Your medal is not affected.',
		seasonsTitle: 'Seasons',
		seasonsBody:
			'Medals and best scores are for the current season, which turns over on September 1. A medal you have earned is yours until then, whatever happens to the roster.',
		recordsTitle: 'Your records',
		recordsBody:
			'Medals and scores are kept in this browser and nowhere else. They are never sent to the server, so they don’t follow you to another device, and clearing your browser’s site data erases them.',
		recordsEmpty: 'Nothing is recorded yet.',
		reset: 'Reset my records',
		resetConfirm: 'Erase every medal and score kept in this browser? This can’t be undone.',
		resetYes: 'Erase them',
		resetCancel: 'Keep them',
		resetDone: 'Your records have been erased.'
	},

	card: {
		prompt: 'Who wears this number?',
		correct: 'Correct!',
		wrong: 'Wrong'
	},

	game: {
		description: (team) =>
			`Learn ${team} jersey numbers, one card at a time — guess who wears each number and work through the full roster.`,
		levelLabel: 'Level',
		levelCurrent: (level) => `Level: ${level}`,
		levelHint: 'Want a challenge? Change the level here.',
		levelHintDismiss: 'Dismiss',
		levels: {
			learn: 'Learn',
			easy: 'Easy',
			medium: 'Medium',
			hard: 'Hard'
		},
		levelOption: (level, choices) => `${level}: ${choices}`,
		levelChoices: (count) => (count === null ? 'full roster' : `${count} choices`),
		medals: {
			bronze: 'bronze medal',
			silver: 'silver medal',
			gold: 'gold medal'
		},
		congratulations: 'Congratulations!',
		allIdentified: () => 'You identified every player on this team!',
		remaining: (count) => `${count} left`,
		progress: 'Progress',
		medalInReach: (medal) => `No misses so far: ${medal} in reach`,
		medalLost: 'No medal this run',
		medalTip: (medal, level, season) =>
			`${medal.charAt(0).toUpperCase()}${medal.slice(1)}: a perfect run at ${level}, ${season}–${String(season + 1).slice(-2)} season`,
		restart: 'Restart',
		wears: (name, sweaterNumber) => `${name} wears #${sweaterNumber}.`,
		firstTry: (found, total) => `First try: ${found} / ${total}`,
		medalEarned: (medal) => `Perfect run: ${medal}`,
		missedHeading: 'Missed on the first try',
		best: (level, found, total) => `Best this season at ${level}: ${found} / ${total}`,
		playAgain: 'Play Again',
		loadingRoster: 'Loading roster',
		noScript: 'Numbrrs needs JavaScript to deal the cards. Turn it on, then reload this page.',
		noRoster: "The roster isn't available right now.",
		retryRoster: 'Try again',
		answerChoices: 'Answer choices',
		guessResult: (correct, sweaterNumber, name) =>
			`${correct ? 'Correct' : 'Wrong'} — #${sweaterNumber} is ${name}.`,
		nextNumber: (sweaterNumber) => `Next: #${sweaterNumber}.`,
		introduced: (sweaterNumber, name) => `New: #${sweaterNumber} is ${name}.`,
		next: 'Next',
		toLearn: (count) => `${count} to learn`,
		finalLap: (count) => `Final lap: ${count} left`,
		lapStart:
			'Final lap: every player once more, and this time the roster keeps its numbers to itself.',
		tryLevel: (level) => `Try ${level}`,
		learnNew: (count) => `Learn ${count} new`,
		hideRoster: 'hide roster',
		showAll: 'show all',
		groups: {
			forwards: () => 'Forwards',
			defense: () => 'Defence',
			goalies: () => 'Goalies',
			other: 'Other'
		}
	},

	positions: {
		C: () => 'Centre',
		L: () => 'Left Wing',
		R: () => 'Right Wing',
		F: () => 'Forward',
		// The same word in every league, which is why it takes no gender.
		D: () => 'Defender',
		G: () => 'Goalie'
	},

	footer: {
		disclaimer:
			'An independent fan project. Not affiliated with or endorsed by the NHL, PWHL, WHL, OHL or QMJHL. Team names and logos are the property of their respective clubs, and trophy names of their respective leagues.',
		privacy: 'Privacy',
		source: 'Source'
	},

	privacy: {
		title: 'Privacy',
		description: 'What Numbrrs records, why, and for how long.',
		summary:
			'Numbrrs counts page views so I can tell whether anyone is using it. There are no accounts, no advertising and no third-party analytics or trackers, and nothing is sold. The companies that deliver the site to you necessarily handle your request; they are named below.',
		collectedTitle: 'What a page view records',
		collected: [
			'The date and time of the visit',
			'The page path and the route it matched',
			'The league and team, when the page is a team page',
			'The language the page was served in',
			'Whether the page came from Cloudflare’s cache or from the site’s own server',
			'The site you arrived from — the host only, never the full address',
			'A visitor code, described below'
		],
		hashTitle: 'The visitor code',
		hashBody:
			'To tell two visitors apart within a single day, your IP address and browser are hashed together with a random value. That random value is generated fresh each day and is never written to disk — so once the day is over, nothing can link the code back to you, and today’s code cannot be matched to tomorrow’s. Your IP address itself is never written to the site’s database. The one place the site writes an IP address down is its server log, which is kept only briefly: a refused or failed attempt to reach the site’s admin page is logged there with the address it came from.',
		cookiesTitle: 'Cookies',
		cookiesBody:
			'None are used for analytics. Two cookies remember preferences — your language (numbrrs_locale) and the last league tab you opened (numbrrs_league) — for one year each. Your level setting is kept in your browser’s local storage (numbrrs_difficulty) and is never sent to the server. So are the medals and best scores you earn, and which players you have named correctly (numbrrs_records), which are not sent either. The same goes for a note that you have closed the hint about changing the level (numbrrs_level_hint). You can clear all of these in your browser at any time, and the How to play page has a button that erases your records. A game in progress is kept in the tab’s session storage (under keys beginning with numbrrs_game, one per team), is never sent to the server, and disappears when the tab is closed.',
		errorsTitle: 'Errors',
		errorsBody:
			'When something breaks — on the server or in your browser — the error message, the page it happened on, and a technical stack trace are recorded so it can be fixed. Your IP address is not attached. Repeats of the same fault collapse into a single record.',
		retentionTitle: 'How long it is kept',
		retentionBody:
			'Page-view records are deleted automatically after 90 days, or sooner if the store passes a fixed size. An error record is deleted 90 days after the fault last occurred; records of browser errors go sooner if they pile up. Backups of the server’s disk can still contain a deleted record until they, too, age out and are discarded.',
		sharingTitle: 'Who else is involved',
		sharingBody:
			'The records above are kept in the site’s own database, on a server in Toronto, Canada, and in backups of it, and I am the only person who reads them. Three companies handle data along the way: Fly.io (United States) runs that server and holds its backups; Cloudflare (United States) sits in front of it, so every request — including your IP address — passes through its network, which may process it outside Canada and keeps its own traffic and security logs; and Discord (United States) receives an alert when an error is recorded, containing the error text and no IP address. Player photos, and the team logos the site does not host itself, load directly from image servers run by the leagues and their statistics provider, so those servers see your IP address, your browser and that you came from Numbrrs when a page shows them.',
		contactTitle: 'Questions',
		contactBody:
			'For a question, a correction, or a request to remove something, open an issue on the project’s GitHub repository.',
		updated: (date) => `Last updated ${date}.`
	},

	error: {
		notFoundTitle: 'Page not found',
		notFoundBody: "That page doesn't exist. The link may be out of date, or a team may have moved.",
		leagueNotFound: 'League not found',
		teamNotFound: 'Team not found',
		genericTitle: 'Something went wrong',
		genericBody: 'Sorry — that request failed on our end. Trying again often works.',
		home: 'Back to the teams',
		reference: 'Reference'
	}
};
