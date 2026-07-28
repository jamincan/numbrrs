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
		noRoster: 'No roster available yet. Refresh in a moment.',
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
			'Numbrrs counts page views so I can tell whether anyone is using it. There are no accounts, no advertising, no third-party trackers, and nothing here is sold or shared.',
		collectedTitle: 'What a page view records',
		collected: [
			'The page path and the route it matched',
			'The league and team, when the page is a team page',
			'The language the page was served in',
			'The site you arrived from — the host only, never the full address',
			'A visitor code, described below'
		],
		hashTitle: 'The visitor code',
		hashBody:
			'To tell two visitors apart within a single day, your IP address and browser are hashed together with a random value. That random value is generated fresh each day and is never written to disk — so once the day is over, nothing can link the code back to you, and today’s code cannot be matched to tomorrow’s. Your IP address itself is never stored.',
		cookiesTitle: 'Cookies',
		cookiesBody:
			'None are used for analytics. Two cookies remember preferences you set — your language and the last league tab you opened — and nothing else reads them.',
		errorsTitle: 'Errors',
		errorsBody:
			'When something breaks, the error message, the page it happened on, and a technical stack trace are recorded so it can be fixed. Repeats of the same fault collapse into a single record.',
		retentionTitle: 'How long it is kept',
		retentionBody:
			'90 days, after which it is deleted automatically. Older records are also removed once the store passes a fixed size.',
		sharingTitle: 'Who else sees it',
		sharingBody:
			'Nobody. Everything is stored on the server that runs the site, in Canada. The only thing that leaves is an error notification to a private channel I watch, which contains the error and no visitor information.',
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
