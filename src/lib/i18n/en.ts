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
		back: 'Back',
		difficulty: {
			easy: 'Easy',
			medium: 'Medium',
			hard: 'Hard',
			expert: 'Expert'
		},
		autoAdvance: 'Auto-advance',
		congratulations: 'Congratulations!',
		allIdentified: () => 'You identified every player on this team!',
		accuracy: (percent) => `Accuracy: ${percent}`,
		playAgain: 'Play Again',
		roster: 'Roster',
		loadingRoster: 'Loading roster',
		noRoster: 'No roster available yet. Refresh in a moment.',
		identified: (found, total) => `${found} / ${total} identified`,
		nextPlayer: () => 'Next Player',
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
	}
};
