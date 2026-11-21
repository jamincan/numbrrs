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
	description:
		'Un jeu de cartes pour apprendre les numéros de chandail au hockey. Choisissez une équipe de la LNH, de la LPHF, de la WHL, de la OHL ou de la LHJMQ et devinez qui porte chaque numéro.',
	tagline: 'Apprenez les numéros de chandail, une carte à la fois',
	language: 'Langue',
	github: 'GitHub',

	home: {
		league: 'Ligue',
		chooseTeam: 'Choisissez une équipe',
		teamsSyncing: 'Les équipes se synchronisent avec la ligue. Actualisez dans un instant.'
	},

	card: {
		prompt: 'Qui porte ce numéro?',
		correct: 'Exact!',
		wrong: 'Raté'
	},

	game: {
		// The team name leads the sentence rather than sitting inside it, which
		// would need the team's grammatical gender for the article.
		description: (team) =>
			`${team} — devinez qui porte chaque numéro et complétez l'alignement, une carte à la fois.`,
		difficultyLabel: 'Difficulté',
		difficulty: {
			easy: 'Facile',
			medium: 'Moyen',
			hard: 'Difficile',
			expert: 'Expert'
		},
		congratulations: 'Félicitations!',
		allIdentified: (gender) =>
			gender === 'f'
				? 'Vous avez identifié toutes les joueuses de cette équipe!'
				: 'Vous avez identifié tous les joueurs de cette équipe!',
		accuracy: (percent) => `Précision${NBSP}: ${percent}`,
		playAgain: 'Rejouer',
		loadingRoster: "Chargement de l'alignement",
		noRoster: "L'alignement n'est pas disponible pour le moment.",
		retryRoster: 'Réessayer',
		identified: (found, total, gender) =>
			`${found} / ${total} ${gender === 'f' ? 'identifiées' : 'identifiés'}`,
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
	},

	footer: {
		disclaimer:
			"Projet indépendant réalisé par un amateur. Sans lien avec la LNH, la PWHL, la WHL, l'OHL ou la LHJMQ, et sans leur approbation. Les noms et logos d'équipe appartiennent à leurs clubs respectifs.",
		privacy: 'Confidentialité',
		source: 'Code source'
	},

	privacy: {
		title: 'Confidentialité',
		description: 'Ce que Numbrrs enregistre, pourquoi, et pour combien de temps.',
		summary:
			'Numbrrs compte les pages consultées, simplement pour savoir si le site sert à quelqu’un. Il n’y a ni compte, ni publicité, ni outil de mesure ou traceur tiers, et rien n’est vendu. Les entreprises qui acheminent le site jusqu’à vous traitent forcément votre requête; elles sont nommées plus bas.',
		collectedTitle: 'Ce qu’une page consultée enregistre',
		collected: [
			'La date et l’heure de la visite',
			'Le chemin de la page et la route correspondante',
			'La ligue et l’équipe, s’il s’agit d’une page d’équipe',
			'La langue dans laquelle la page a été servie',
			'Le site d’où vous arrivez — le domaine seulement, jamais l’adresse complète',
			'Un code de visite, décrit ci-dessous'
		],
		hashTitle: 'Le code de visite',
		hashBody: `Pour distinguer deux visiteurs au cours d’une même journée, votre adresse IP et votre navigateur sont hachés avec une valeur aléatoire. Cette valeur est régénérée chaque jour et n’est jamais écrite sur disque${NBSP}: une fois la journée terminée, plus rien ne relie le code à vous, et le code d’aujourd’hui ne peut être rapproché de celui de demain. Votre adresse IP elle-même n’est jamais inscrite dans la base de données du site. Le seul endroit où le site consigne une adresse IP est le journal de son serveur, conservé peu de temps${NBSP}: une tentative refusée ou échouée d’accéder à la page d’administration du site y est notée avec l’adresse d’où elle provient.`,
		cookiesTitle: 'Témoins (cookies)',
		cookiesBody:
			'Aucun n’est utilisé à des fins de mesure. Deux témoins retiennent vos préférences — votre langue (numbrrs_locale) et le dernier onglet de ligue ouvert (numbrrs_league) — pendant un an chacun. Votre niveau de difficulté est gardé dans le stockage local de votre navigateur (numbrrs_difficulty) et n’est jamais envoyé au serveur. Vous pouvez effacer les trois en tout temps dans votre navigateur.',
		errorsTitle: 'Erreurs',
		errorsBody:
			'Lorsqu’une erreur survient — sur le serveur ou dans votre navigateur —, son message, la page concernée et une trace technique sont enregistrés afin de pouvoir la corriger. Votre adresse IP n’y est pas jointe. Les occurrences répétées d’une même erreur sont regroupées en une seule entrée.',
		retentionTitle: 'Durée de conservation',
		retentionBody:
			'Les enregistrements de pages consultées sont supprimés automatiquement après 90 jours, ou plus tôt si le stockage dépasse une taille fixée. Une entrée d’erreur est supprimée 90 jours après la dernière occurrence de l’erreur; celles qui proviennent des navigateurs le sont plus tôt si elles s’accumulent. Les copies de sauvegarde du disque du serveur peuvent encore contenir un enregistrement supprimé, jusqu’à ce qu’elles soient éliminées à leur tour.',
		sharingTitle: 'Qui d’autre intervient',
		sharingBody: `Les enregistrements décrits ci-dessus sont conservés dans la base de données du site, sur un serveur situé à Toronto, au Canada, ainsi que dans ses copies de sauvegarde, et je suis la seule personne à les consulter. Trois entreprises interviennent en cours de route${NBSP}: Fly.io (États-Unis) exploite ce serveur et en détient les copies de sauvegarde; Cloudflare (États-Unis) est placée devant lui, de sorte que chaque requête — y compris votre adresse IP — transite par son réseau, qui peut la traiter à l’extérieur du Canada et tient ses propres journaux de trafic et de sécurité; et Discord (États-Unis) reçoit une alerte lorsqu’une erreur est enregistrée, contenant le texte de l’erreur, sans adresse IP. Les photos des joueuses et des joueurs, ainsi que les logos d’équipe que le site n’héberge pas lui-même, sont chargés directement depuis des serveurs d’images exploités par les ligues et par leur fournisseur de statistiques; ces serveurs voient donc votre adresse IP, votre navigateur et le fait que vous venez de Numbrrs lorsqu’une page les affiche.`,
		contactTitle: 'Questions',
		contactBody:
			'Pour une question, une correction ou une demande de suppression, ouvrez un ticket dans le dépôt GitHub du projet.',
		updated: (date) => `Dernière mise à jour${NBSP}: ${date}.`
	},

	error: {
		notFoundTitle: 'Page introuvable',
		notFoundBody:
			"Cette page n'existe pas. Le lien est peut-être périmé, ou une équipe a peut-être changé.",
		genericTitle: 'Une erreur est survenue',
		genericBody: 'Désolé, cette requête a échoué de notre côté. Réessayer fonctionne souvent.',
		home: 'Retour aux équipes',
		reference: 'Référence'
	}
};
