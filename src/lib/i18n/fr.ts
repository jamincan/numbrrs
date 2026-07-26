import type { Messages } from './messages';

/**
 * French keeps ":" attached to the word before it with a non-breaking space.
 * Built from its code point rather than typed literally: a real U+00A0 in a string
 * is invisible in review, trips the no-irregular-whitespace lint, and gets
 * silently "corrected" to a normal space by editors.
 */
const NBSP = String.fromCharCode(0xa0);

// Quebec French, since every league here is Canadian: "chandail" rather than
// "maillot", "alignement" for a roster, "attaquant" for a forward.
//
// Punctuation follows Quebec (OQLF) convention rather than French-from-France:
// no space before "?" and "!". The space before "%" comes from
// Intl.NumberFormat, not from these strings.
//
// Messages that name players take a gender, because French has no neutral
// form and the PWHL is a women's league — see `Gender` in ./index.
export const fr: Messages = {
	title: 'Numbrrs - Apprenez les numéros de chandail',
	tagline: 'Apprenez les numéros de chandail, une carte à la fois',
	language: 'Langue',
	github: 'GitHub',

	home: {
		league: 'Ligue',
		chooseTeam: 'Choisissez une équipe',
		loadingTeams: 'Chargement des équipes...',
		teamsSyncing: 'Les équipes se synchronisent avec la ligue. Actualisez dans un instant.'
	},

	card: {
		prompt: 'Qui porte ce numéro?',
		correct: 'Exact!',
		wrong: 'Raté'
	},

	game: {
		back: 'Retour',
		difficulty: {
			easy: 'Facile',
			medium: 'Moyen',
			hard: 'Difficile',
			expert: 'Expert'
		},
		autoAdvance: 'Passage automatique',
		congratulations: 'Félicitations!',
		allIdentified: (gender) =>
			gender === 'f'
				? 'Vous avez identifié toutes les joueuses de cette équipe!'
				: 'Vous avez identifié tous les joueurs de cette équipe!',
		accuracy: (percent) => `Précision${NBSP}: ${percent}`,
		playAgain: 'Rejouer',
		roster: 'Alignement',
		loadingRoster: "Chargement de l'alignement",
		noRoster: 'Aucun alignement disponible pour le moment. Actualisez dans un instant.',
		identified: (found, total, gender) =>
			`${found} / ${total} ${gender === 'f' ? 'identifiées' : 'identifiés'}`,
		nextPlayer: (gender) => (gender === 'f' ? 'Joueuse suivante' : 'Joueur suivant'),
		collapseRoster: "Réduire l'alignement",
		expandRoster: "Afficher l'alignement",
		hideRoster: "masquer l'alignement",
		showAll: 'tout afficher',
		groups: {
			forwards: (gender) => (gender === 'f' ? 'Attaquantes' : 'Attaquants'),
			defense: (gender) => (gender === 'f' ? 'Défenseures' : 'Défenseurs'),
			goalies: (gender) => (gender === 'f' ? 'Gardiennes' : 'Gardiens'),
			other: 'Autres'
		}
	},

	positions: {
		C: () => 'Centre',
		L: (gender) => (gender === 'f' ? 'Ailière gauche' : 'Ailier gauche'),
		R: (gender) => (gender === 'f' ? 'Ailière droite' : 'Ailier droit'),
		F: (gender) => (gender === 'f' ? 'Attaquante' : 'Attaquant'),
		D: (gender) => (gender === 'f' ? 'Défenseure' : 'Défenseur'),
		G: (gender) => (gender === 'f' ? 'Gardienne' : 'Gardien')
	}
};
