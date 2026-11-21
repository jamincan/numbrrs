import type { Messages } from './messages';

export const en: Messages = {
	title: 'Numbrrs - Learn Hockey Jersey Numbers',
	description:
		'A flashcard game for learning hockey jersey numbers. Pick a team from the NHL, PWHL, WHL, OHL or QMJHL and guess who wears each number.',
	tagline: 'Learn hockey jersey numbers, one card at a time',
	language: 'Language',
	github: 'GitHub',

	home: {
		league: 'League',
		chooseTeam: 'Choose a Team',
		teamsSyncing: 'Teams are still syncing from the league. Refresh in a moment.'
	},

	card: {
		prompt: 'Who wears this number?',
		correct: 'Correct!',
		wrong: 'Wrong'
	},

	game: {
		description: (team) =>
			`Learn ${team} jersey numbers, one card at a time — guess who wears each number and work through the full roster.`,
		difficultyLabel: 'Difficulty',
		difficulty: {
			easy: 'Easy',
			medium: 'Medium',
			hard: 'Hard',
			expert: 'Expert'
		},
		congratulations: 'Congratulations!',
		allIdentified: () => 'You identified every player on this team!',
		accuracy: (percent) => `Accuracy: ${percent}`,
		playAgain: 'Play Again',
		loadingRoster: 'Loading roster',
		noRoster: "The roster isn't available right now.",
		retryRoster: 'Try again',
		identified: (found, total) => `${found} / ${total} identified`,
		collapseRoster: 'Collapse roster',
		expandRoster: 'Expand roster',
		hideRoster: 'hide roster',
		showAll: 'show all',
		groups: {
			forwards: () => 'Forwards',
			defense: () => 'Defense',
			goalies: () => 'Goalies',
			other: 'Other'
		}
	},

	positions: {
		C: () => 'Center',
		L: () => 'Left Wing',
		R: () => 'Right Wing',
		F: () => 'Forward',
		D: () => 'Defenseman',
		G: () => 'Goalie'
	},

	footer: {
		disclaimer:
			'An independent fan project. Not affiliated with or endorsed by the NHL, PWHL, WHL, OHL or QMJHL. Team names and logos are the property of their respective clubs.',
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
			'The site you arrived from — the host only, never the full address',
			'A visitor code, described below'
		],
		hashTitle: 'The visitor code',
		hashBody:
			'To tell two visitors apart within a single day, your IP address and browser are hashed together with a random value. That random value is generated fresh each day and is never written to disk — so once the day is over, nothing can link the code back to you, and today’s code cannot be matched to tomorrow’s. Your IP address itself is never written to the site’s database. The one place the site writes an IP address down is its server log, which is kept only briefly: a refused or failed attempt to reach the site’s admin page is logged there with the address it came from.',
		cookiesTitle: 'Cookies',
		cookiesBody:
			'None are used for analytics. Two cookies remember preferences — your language (numbrrs_locale) and the last league tab you opened (numbrrs_league) — for one year each. Your difficulty setting is kept in your browser’s local storage (numbrrs_difficulty) and is never sent to the server. You can clear all three in your browser at any time.',
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
		genericTitle: 'Something went wrong',
		genericBody: 'Sorry — that request failed on our end. Trying again often works.',
		home: 'Back to the teams',
		reference: 'Reference'
	}
};
